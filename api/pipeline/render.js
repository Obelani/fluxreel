const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { readVerifiedQstashPayload, markVideoFailed } = require('../_lib/pipelineStage');
const { CAPTION_STYLES } = require('../_lib/pipelineConfig');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

module.exports.config = { api: { bodyParser: false } };

// Distribui a duração total do vídeo entre as cenas, proporcional ao
// tamanho do texto narrado em cada uma (aproximação — não temos o timestamp
// exato de onde cada cena começa/termina dentro do áudio único).
function buildSceneDurations(scenes, totalDuration) {
  const totalChars = scenes.reduce(function (sum, s) { return sum + s.narration.length; }, 0) || 1;
  return scenes.map(function (scene) {
    const share = scene.narration.length / totalChars;
    return Math.max(totalDuration * share, 1);
  });
}

function runFfmpeg(args) {
  return new Promise(function (resolve, reject) {
    execFile(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 20 }, function (err, stdout, stderr) {
      if (err) {
        reject(new Error('ffmpeg falhou: ' + String(stderr || err.message).slice(0, 2000)));
      } else {
        resolve();
      }
    });
  });
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Falha ao baixar ' + url + ': ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(destPath, buf);
}

// Converte cor CSS (#RRGGBB ou rgba(r,g,b,a)) pro formato &HAABBGGRR& do ASS
// (alpha invertido: 00 = opaco, FF = transparente).
function toAssColor(cssColor) {
  let r = 255, g = 255, b = 255, alpha = 0;
  const hexMatch = /^#([0-9a-fA-F]{6})$/.exec(cssColor || '');
  const rgbaMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(cssColor || '');
  if (hexMatch) {
    const hex = hexMatch[1];
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else if (rgbaMatch) {
    r = parseInt(rgbaMatch[1], 10);
    g = parseInt(rgbaMatch[2], 10);
    b = parseInt(rgbaMatch[3], 10);
    const opacity = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
    alpha = Math.round((1 - opacity) * 255);
  }
  function hex2(n) { return n.toString(16).toUpperCase().padStart(2, '0'); }
  return '&H' + hex2(alpha) + hex2(b) + hex2(g) + hex2(r) + '&';
}

function formatAssTime(seconds) {
  const s = Math.max(seconds, 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const remSec = s - h * 3600 - m * 60;
  let secStr = remSec.toFixed(2);
  if (remSec < 10) secStr = '0' + secStr;
  return h + ':' + String(m).padStart(2, '0') + ':' + secStr;
}

function escapeAssText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

// Monta a legenda como arquivo .ass (formato ASS/SSA, o ffmpeg queima nativo
// via filtro `ass=`) — uma linha de diálogo por palavra, cobrindo a janela
// [start,end] dela, com a palavra atual em destaque (highlightTextColor) e
// as outras da mesma linha em fillColor (igual ao efeito do preview do
// wizard). Fundo colorido (bold-yellow/blackbox) é aproximado com contorno
// (\bord/\3c) — não é uma "pílula" de verdade, ajustar depois de ver um
// render real.
function buildAssSubtitles(words, style, videoWidth, videoHeight) {
  const LINE_SIZE = 6;
  const lines = [];
  for (let i = 0; i < words.length; i += LINE_SIZE) lines.push(words.slice(i, i + LINE_SIZE));

  const fillColor = toAssColor(style.fillColor);
  const highlightColor = toAssColor(style.highlightTextColor);
  const bgColor = style.backgroundColor ? toAssColor(style.backgroundColor) : null;
  const fontSize = Math.round(videoHeight * 0.045);
  const bold = style.fontWeight >= 700 ? -1 : 0;

  const header = '[Script Info]\n' +
    'ScriptType: v4.00+\n' +
    'PlayResX: ' + videoWidth + '\n' +
    'PlayResY: ' + videoHeight + '\n' +
    'WrapStyle: 0\n' +
    'ScaledBorderAndShadow: yes\n\n' +
    '[V4+ Styles]\n' +
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n' +
    'Style: Default,' + style.fontFamily + ',' + fontSize + ',' + fillColor + ',' + fillColor + ',&H00000000&,&H00000000&,' + bold + ',0,0,0,100,100,0,0,1,3,0,2,60,60,180,1\n\n' +
    '[Events]\n' +
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';

  function wordOverride(active) {
    if (active) {
      return '{\\c' + highlightColor + (bgColor ? '\\3c' + bgColor + '\\bord5' : '') + '}';
    }
    return '{\\c' + fillColor + (bgColor ? '\\3c&H00000000&\\bord3' : '') + '}';
  }

  const body = lines.map(function (line) {
    if (!line.length) return '';
    return line.map(function (activeWord, i) {
      const text = line.map(function (w, j) {
        return wordOverride(j === i) + escapeAssText(w.word.toUpperCase());
      }).join(' ');
      return 'Dialogue: 0,' + formatAssTime(activeWord.start) + ',' + formatAssTime(activeWord.end) + ',Default,,0,0,0,,' + text;
    }).join('\n');
  }).join('\n');

  return header + body + '\n';
}

const TRANSITION_DURATION = 0.5;
const TRANSITIONS = ['fade', 'dissolve', 'slideleft', 'slideright'];

// Slideshow de imagens (uma por cena) com transição entre elas via `xfade`
// (fade/dissolve/slide alternados) em vez de corte seco. Cada imagem entra
// como um input de vídeo estático (`-loop 1 -t duração`) e as transições
// são encadeadas num filter_complex — mais trabalhoso que o concat demuxer
// de antes, mas é a forma do ffmpeg de sobrepor um clipe no outro.
async function buildVisuals(workDir, imagePaths, sceneDurations, width, height) {
  const n = imagePaths.length;
  const scaleFilter = 'scale=' + width + ':' + height + ':force_original_aspect_ratio=increase,crop=' + width + ':' + height + ',setsar=1,fps=30,format=yuv420p';
  const visualsPath = path.join(workDir, 'visuals.mp4');

  if (n === 1) {
    await runFfmpeg([
      '-y', '-loop', '1', '-t', sceneDurations[0].toFixed(3), '-i', imagePaths[0],
      '-vf', scaleFilter,
      '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      visualsPath,
    ]);
    return visualsPath;
  }

  const T = TRANSITION_DURATION;
  // Cada xfade sobrepõe T segundos de um clipe no outro, então o total
  // encolhe (n-1)*T se não compensarmos — infla a duração de cada cena
  // (exceto a última) em T pra o resultado final bater com a narração.
  const durations = sceneDurations.map(function (d, i) { return i < n - 1 ? d + T : d; });

  const args = ['-y'];
  imagePaths.forEach(function (p, i) {
    args.push('-loop', '1', '-t', durations[i].toFixed(3), '-i', p);
  });

  const filterParts = imagePaths.map(function (p, i) {
    return '[' + i + ':v]' + scaleFilter + '[v' + i + ']';
  });

  let cum = durations[0];
  let lastLabel = 'v0';
  for (let i = 1; i < n; i++) {
    const offset = cum - T;
    const outLabel = i === n - 1 ? 'vout' : 'vx' + i;
    const transition = TRANSITIONS[(i - 1) % TRANSITIONS.length];
    filterParts.push('[' + lastLabel + '][v' + i + ']xfade=transition=' + transition + ':duration=' + T + ':offset=' + offset.toFixed(3) + '[' + outLabel + ']');
    cum = cum + durations[i] - T;
    lastLabel = outLabel;
  }

  args.push(
    '-filter_complex', filterParts.join(';'),
    '-map', '[vout]',
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    visualsPath
  );
  await runFfmpeg(args);
  return visualsPath;
}

// Narração sozinha, ou narração + música de fundo (música em loop, volume
// baixo, cortada na duração da narração) misturadas num único trilho.
async function buildAudio(workDir, narrationPath, musicPath) {
  if (!musicPath) return narrationPath;
  const outPath = path.join(workDir, 'audio_mixed.m4a');
  await runFfmpeg([
    '-y', '-stream_loop', '-1', '-i', musicPath, '-i', narrationPath,
    // amix aceita duration=longest|shortest|first (não "second") — por isso
    // a narração (segunda entrada) vai primeiro no amix, com duration=first.
    '-filter_complex', '[0:a]volume=0.15[music];[1:a][music]amix=inputs=2:duration=first:dropout_transition=0[aout]',
    '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k',
    outPath,
  ]);
  return outPath;
}

async function combineWithCaptions(workDir, visualsPath, audioPath, assPath, fontsDir) {
  const outPath = path.join(workDir, 'output.mp4');
  await runFfmpeg([
    '-y', '-i', visualsPath, '-i', audioPath,
    '-vf', 'ass=' + assPath + ':fontsdir=' + fontsDir,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '192k', '-shortest',
    outPath,
  ]);
  return outPath;
}

// Etapa 5: monta o vídeo final (imagens + narração + música + legenda
// queimada) direto com ffmpeg, sem depender de nenhuma API externa nem
// serviço à parte — só processamento local, dentro da própria function.
// Precisa do maxDuration alto (configurado em vercel.json, via Fluid
// Compute) porque um render completo passa fácil dos 10s padrão.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const supabase = getSupabaseAdmin();
  let payload;
  try {
    payload = await readVerifiedQstashPayload(req);
  } catch (err) {
    console.error('[pipeline/render] Payload/assinatura inválida:', err.message);
    res.status(401).end();
    return;
  }

  const videoId = payload.video_id;
  let workDir;

  try {
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('*, series:series_id(*)')
      .eq('id', videoId)
      .single();
    if (videoError) throw videoError;

    const words = video.captions_json && video.captions_json.words;
    if (!words || !words.length) throw new Error('captions_json sem palavras');
    const totalDuration = words[words.length - 1].end;
    const sceneDurations = buildSceneDurations(video.script.scenes, totalDuration);
    const style = CAPTION_STYLES[video.series.caption_style] || CAPTION_STYLES.classic;

    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'render-'));

    const imagePaths = await Promise.all(video.image_urls.map(async function (url, i) {
      const dest = path.join(workDir, 'img' + i + '.jpg');
      await downloadFile(url, dest);
      return dest;
    }));

    const narrationPath = path.join(workDir, 'narration.mp3');
    await downloadFile(video.audio_url, narrationPath);

    let musicPath = null;
    if (video.series.music) {
      musicPath = path.join(workDir, 'music.mp3');
      await downloadFile(process.env.BASE_URL + '/music/' + video.series.music + '.mp3', musicPath);
    }

    // Baixa as fontes por URL em vez de ler do disco do projeto — a Vercel
    // não inclui `fonts/` no bundle da function automaticamente (só rastreia
    // arquivos importados via require/import), então precisamos delas como
    // asset público, igual já era feito com a Creatomate.
    const fontsDir = path.join(workDir, 'fonts');
    await fsp.mkdir(fontsDir);
    await Promise.all([
      downloadFile(process.env.BASE_URL + '/fonts/Montserrat-Bold.ttf', path.join(fontsDir, 'Montserrat-Bold.ttf')),
      downloadFile(process.env.BASE_URL + '/fonts/Montserrat-Black.ttf', path.join(fontsDir, 'Montserrat-Black.ttf')),
    ]);

    const WIDTH = 1080, HEIGHT = 1920;
    const visualsPath = await buildVisuals(workDir, imagePaths, sceneDurations, WIDTH, HEIGHT);
    const audioPath = await buildAudio(workDir, narrationPath, musicPath);

    const assPath = path.join(workDir, 'captions.ass');
    await fsp.writeFile(assPath, buildAssSubtitles(words, style, WIDTH, HEIGHT));

    const outputPath = await combineWithCaptions(workDir, visualsPath, audioPath, assPath, fontsDir);

    const fileBuffer = await fsp.readFile(outputPath);
    const storagePath = 'videos/' + videoId + '.mp4';
    const { error: uploadError } = await supabase.storage
      .from('media')
      .upload(storagePath, fileBuffer, { contentType: 'video/mp4', upsert: true });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from('media').getPublicUrl(storagePath);

    await supabase
      .from('videos')
      .update({ video_url: publicUrlData.publicUrl, status: 'ready', updated_at: new Date().toISOString() })
      .eq('id', videoId);

    console.log('[pipeline/render] Vídeo', videoId, 'renderizado e publicado com sucesso.');
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[pipeline/render] Falha ao renderizar', videoId, err);
    await markVideoFailed(supabase, videoId, err.message);
    res.status(200).json({ ok: false });
  } finally {
    if (workDir) await fsp.rm(workDir, { recursive: true, force: true }).catch(function () {});
  }
};
