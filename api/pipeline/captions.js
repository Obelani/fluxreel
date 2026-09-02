const Anthropic = require('@anthropic-ai/sdk');
const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { readVerifiedQstashPayload, markVideoFailed } = require('../_lib/pipelineStage');
const { publishNextStep } = require('../_lib/qstash');
const { transcribeWithWordTimestamps } = require('../_lib/groqWhisper');
const { generateNarrationAudio } = require('../_lib/elevenlabs');
const { VOICE_IDS, DURATION_BUCKET_SECONDS } = require('../_lib/pipelineConfig');

module.exports.config = { api: { bodyParser: false } };

const STORAGE_BUCKET = 'media';

// Tolerância acima do topo da faixa antes de considerar "estourou de
// verdade" — a faixa já tem uma margem (ex.: "30-40s"), não faz sentido
// regenerar por causa de 1-2s a mais do topo.
const DURATION_TOLERANCE = 1.15;

// Pede pro Claude reescrever só a narração (mantendo cena, visual,
// personagens e universo intactos — por isso as imagens já geradas
// continuam válidas) com base na duração REAL medida, não numa estimativa.
async function rewriteNarrationShorter(scriptData, actualSeconds, targetSeconds) {
  const overshootPct = Math.round(((actualSeconds / targetSeconds) - 1) * 100);
  const scenesSummary = scriptData.scenes
    .map(function (s, i) { return 'Cena ' + (i + 1) + ' (' + s.role + '): "' + s.narration + '"'; })
    .join(' | ');

  const rewriteTool = {
    name: 'narracao_revisada',
    description: 'Narração revisada e mais curta, cena a cena, na mesma ordem e quantidade da original.',
    input_schema: {
      type: 'object',
      properties: {
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              narration: { type: 'string', description: 'Narração revisada dessa cena, em português do Brasil — mesma ideia da original, só mais econômica.' },
            },
            required: ['narration'],
          },
        },
      },
      required: ['scenes'],
    },
  };

  const prompt = [
    'O áudio gerado a partir da narração abaixo durou ' + actualSeconds.toFixed(1) + ' segundos, mas o alvo é até ' + targetSeconds + ' segundos (cerca de ' + overshootPct + '% acima do esperado).',
    'Reescreva a narração de CADA cena, na MESMA ordem e MESMA quantidade de cenas (' + scriptData.scenes.length + '), mantendo a mesma história, o mesmo gancho inicial e a mesma conclusão forte na última cena — só bem mais direta e econômica em palavras, o suficiente pra reduzir a duração falada em aproximadamente ' + overshootPct + '%.',
    'Título do vídeo: "' + scriptData.title + '".',
    'Cenas originais: ' + scenesSummary,
  ].join(' ');

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 2048,
    tools: [rewriteTool],
    tool_choice: { type: 'tool', name: 'narracao_revisada' },
    messages: [{ role: 'user', content: prompt }],
  });
  const toolUse = response.content.find(function (block) { return block.type === 'tool_use'; });
  if (!toolUse) throw new Error('Claude não retornou a narração revisada no formato esperado');
  const revisedScenes = toolUse.input.scenes;
  if (!revisedScenes || revisedScenes.length !== scriptData.scenes.length) {
    throw new Error('Narração revisada veio com número de cenas diferente do original');
  }
  return revisedScenes;
}

// Gera a narração (ElevenLabs) + transcreve com timestamp por palavra (Groq
// Whisper) a partir do texto atual de video.script.scenes, e sobe o áudio
// pro Storage. Reaproveitado tanto na primeira tentativa quanto na
// regeneração depois de reescrever a narração mais curta.
async function synthesizeAndTranscribe(supabase, videoId, voiceId, scenes) {
  const fullText = scenes.map(function (s) { return s.narration; }).join(' ');
  const audioBuffer = await generateNarrationAudio(voiceId, fullText);

  const storagePath = 'narration/' + videoId + '.mp3';
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg', upsert: true });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

  const transcription = await transcribeWithWordTimestamps(publicUrlData.publicUrl);
  const words = transcription.words || [];
  if (!words.length) throw new Error('Groq não retornou timestamps por palavra');

  return { audioUrl: publicUrlData.publicUrl, words: words };
}

// Etapa 4: transcreve o áudio de narração com timestamp por palavra (Groq
// Whisper) — usado na etapa de render pra queimar a legenda sincronizada.
// Também é aqui que validamos a duração REAL do vídeo (não uma estimativa
// de palavras) contra a faixa escolhida no wizard — se estourou de
// verdade, pede uma narração mais curta e regenera áudio+transcrição uma
// vez. As imagens já geradas continuam válidas (só a narração muda, não a
// cena/visual/personagens/universo).
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
    console.error('[pipeline/captions] Payload/assinatura inválida:', err.message);
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
    if (!video.audio_url) throw new Error('Vídeo sem audio_url — etapa de narração não terminou direito');

    let audioUrl = video.audio_url;
    let scriptData = video.script;

    const transcription = await transcribeWithWordTimestamps(audioUrl);
    let words = transcription.words || [];
    if (!words.length) throw new Error('Groq não retornou timestamps por palavra');

    const targetSeconds = DURATION_BUCKET_SECONDS[video.series.duration_bucket] || 40;
    const actualSeconds = words[words.length - 1].end;

    if (actualSeconds > targetSeconds * DURATION_TOLERANCE) {
      console.warn('[pipeline/captions] Vídeo', videoId, 'com', actualSeconds.toFixed(1), 's de narração (alvo', targetSeconds + 's) — regenerando narração mais curta.');
      try {
        const voiceId = VOICE_IDS[video.series.voice];
        if (!voiceId) throw new Error('Voz "' + video.series.voice + '" sem voice_id configurado');

        const revisedScenes = await rewriteNarrationShorter(scriptData, actualSeconds, targetSeconds);
        const newScenes = scriptData.scenes.map(function (scene, i) {
          return Object.assign({}, scene, { narration: revisedScenes[i].narration });
        });

        const result = await synthesizeAndTranscribe(supabase, videoId, voiceId, newScenes);
        const newActualSeconds = result.words[result.words.length - 1].end;
        console.warn('[pipeline/captions] Vídeo', videoId, 'regenerado:', newActualSeconds.toFixed(1), 's.');

        scriptData = Object.assign({}, scriptData, { scenes: newScenes });
        audioUrl = result.audioUrl;
        words = result.words;
      } catch (retryErr) {
        console.error('[pipeline/captions] Falha ao regenerar narração mais curta do vídeo', videoId, '— seguindo com a versão original.', retryErr.message);
      }
    }

    await supabase
      .from('videos')
      .update({
        script: scriptData,
        audio_url: audioUrl,
        captions_json: { words: words },
        status: 'rendering',
        updated_at: new Date().toISOString(),
      })
      .eq('id', videoId);

    await publishNextStep('/api/pipeline/render', { video_id: videoId });

    res.status(200).json({ ok: true });
  } catch (err) {
    await markVideoFailed(supabase, videoId, err.message);
    res.status(200).json({ ok: false });
  }
};
