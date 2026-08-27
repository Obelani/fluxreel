const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { readVerifiedQstashPayload, markVideoFailed } = require('../_lib/pipelineStage');
const { CAPTION_STYLES } = require('../_lib/pipelineConfig');

module.exports.config = { api: { bodyParser: false } };

// Distribui a duração total do vídeo entre as cenas, proporcional ao
// tamanho do texto narrado em cada uma (aproximação — não temos o timestamp
// exato de onde cada cena começa/termina dentro do áudio único).
function buildSceneImageElements(scenes, imageUrls, totalDuration) {
  const totalChars = scenes.reduce(function (sum, s) { return sum + s.narration.length; }, 0) || 1;
  return scenes.map(function (scene, i) {
    const share = scene.narration.length / totalChars;
    return {
      type: 'image',
      track: 1,
      source: imageUrls[i],
      duration: Math.max(totalDuration * share, 1),
    };
  });
}

// Legenda montada manualmente: 1-2 palavras por vez, em maiúsculas, cada
// bloco com seu próprio time/duration sincronizado ao timestamp do Groq.
// width/height ficam null de propósito — assim o elemento (e o fundo tipo
// "pílula", quando o estilo tem background_color) se ajusta ao tamanho do
// texto de cada bloco, em vez de esticar numa barra fixa cobrindo a tela.
function buildCaptionElements(words, style) {
  const CHUNK_SIZE = 2;
  const elements = [];
  for (let i = 0; i < words.length; i += CHUNK_SIZE) {
    const chunk = words.slice(i, i + CHUNK_SIZE);
    const text = chunk.map(function (w) { return w.word.toUpperCase(); }).join(' ').trim();
    if (!text) continue;
    const start = chunk[0].start;
    const end = chunk[chunk.length - 1].end;

    const el = {
      type: 'text',
      track: 4,
      time: start,
      duration: Math.max(end - start, 0.35),
      text: text,
      x: '50%',
      y: '80%',
      width: null,
      height: null,
      x_alignment: '50%',
      y_alignment: '50%',
      font_family: style.font_family || 'Arial',
      font_weight: style.font_weight,
      font_size: '7.5 vmin',
      fill_color: style.fill_color,
    };
    if (style.stroke_color) {
      el.stroke_color = style.stroke_color;
      el.stroke_width = style.stroke_width;
    }
    if (style.background_color) {
      el.background_color = style.background_color;
      el.background_x_padding = style.background_x_padding;
      el.background_y_padding = style.background_y_padding;
      el.background_border_radius = style.background_border_radius;
    }
    elements.push(el);
  }
  return elements;
}

// Modo "vitrine" (usado por api/_dev/preview-caption-styles.js): mostra os 5
// estilos ao mesmo tempo, um embaixo do outro com um rótulo em cima de cada
// um, pra comparar visualmente sem precisar gerar 5 vídeos separados.
function buildStylePreviewElements(words, totalDuration) {
  const sampleText = words.slice(0, 4).map(function (w) { return w.word.toUpperCase(); }).join(' ');
  const yPositions = ['12%', '28%', '44%', '60%', '76%'];
  const elements = [];
  let track = 4;

  Object.keys(CAPTION_STYLES).forEach(function (key, i) {
    const style = CAPTION_STYLES[key];
    const y = yPositions[i] || (12 + i * 16) + '%';

    elements.push({
      type: 'text',
      track: track++,
      time: 0,
      duration: totalDuration,
      text: key,
      x: '8%',
      y: y,
      width: null,
      height: null,
      x_alignment: '0%',
      y_alignment: '0%',
      font_family: 'Arial',
      font_weight: '400',
      font_size: '2.6 vmin',
      fill_color: '#AAAAAA',
    });

    const el = {
      type: 'text',
      track: track++,
      time: 0,
      duration: totalDuration,
      text: sampleText,
      x: '50%',
      y: y,
      width: null,
      height: null,
      x_alignment: '50%',
      y_alignment: '100%',
      font_family: style.font_family,
      font_weight: style.font_weight,
      font_size: '4.5 vmin',
      fill_color: style.fill_color,
    };
    if (style.stroke_color) {
      el.stroke_color = style.stroke_color;
      el.stroke_width = style.stroke_width;
    }
    if (style.background_color) {
      el.background_color = style.background_color;
      el.background_x_padding = style.background_x_padding;
      el.background_y_padding = style.background_y_padding;
      el.background_border_radius = style.background_border_radius;
    }
    elements.push(el);
  });

  return elements;
}

// Etapa 5: monta a composição (imagens + narração + música + legenda) e
// dispara o render na Creatomate. Ela renderiza de forma assíncrona e chama
// de volta `render-webhook.js` quando terminar — essa function só dispara e
// retorna, o status do vídeo continua 'rendering' até o webhook confirmar.
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

    const imageElements = buildSceneImageElements(video.script.scenes, video.image_urls, totalDuration);
    const captionElements = payload.preview_all_styles
      ? buildStylePreviewElements(words, totalDuration)
      : buildCaptionElements(words, CAPTION_STYLES[video.series.caption_style] || CAPTION_STYLES.classic);

    const elements = imageElements.concat([{ type: 'audio', track: 2, source: video.audio_url }]);
    if (video.series.music) {
      elements.push({
        type: 'audio',
        track: 3,
        source: process.env.BASE_URL + '/music/' + video.series.music + '.mp3',
        volume: '15%',
        duration: totalDuration,
      });
    }
    elements.push.apply(elements, captionElements);

    // O video_id vai na própria URL do webhook (query string) — assim não
    // dependemos de a Creatomate ecoar nenhum campo de metadata específico
    // de volta pra sabermos a qual vídeo o callback se refere.
    const webhookUrl = process.env.BASE_URL + '/api/pipeline/render-webhook?video_id=' + encodeURIComponent(videoId);

    const renderRes = await fetch('https://api.creatomate.com/v1/renders', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.CREATOMATE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: {
          output_format: 'mp4',
          width: 1080,
          height: 1920,
          fonts: [
            { family: 'Montserrat', weight: '700', style: 'normal', source: process.env.BASE_URL + '/fonts/Montserrat-Bold.ttf' },
            { family: 'Montserrat', weight: '900', style: 'normal', source: process.env.BASE_URL + '/fonts/Montserrat-Black.ttf' },
          ],
          elements: elements,
        },
        webhook_url: webhookUrl,
      }),
    });

    if (!renderRes.ok) {
      const errText = await renderRes.text().catch(function () { return ''; });
      throw new Error('Creatomate respondeu ' + renderRes.status + ': ' + errText.slice(0, 800));
    }

    const renderData = await renderRes.json().catch(function () { return null; });
    console.log('[pipeline/render] Render disparado pra vídeo', videoId, '— resposta da Creatomate:', JSON.stringify(renderData));

    res.status(200).json({ ok: true });
  } catch (err) {
    await markVideoFailed(supabase, videoId, err.message);
    res.status(200).json({ ok: false });
  }
};
