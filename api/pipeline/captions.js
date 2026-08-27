const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { readVerifiedQstashPayload, markVideoFailed } = require('../_lib/pipelineStage');
const { publishNextStep } = require('../_lib/qstash');

module.exports.config = { api: { bodyParser: false } };

async function transcribeWithWordTimestamps(audioUrl) {
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error('Não foi possível baixar o áudio pra transcrever: ' + audioRes.status);
  const audioBuffer = await audioRes.arrayBuffer();

  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'narration.mp3');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('language', 'pt');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY },
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text().catch(function () { return ''; });
    throw new Error('Groq respondeu ' + res.status + ': ' + errText.slice(0, 500));
  }
  return res.json();
}

// Etapa 4: transcreve o áudio de narração com timestamp por palavra (Groq
// Whisper) — usado na etapa de render pra queimar a legenda sincronizada.
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
    const { data: video, error: videoError } = await supabase.from('videos').select('audio_url').eq('id', videoId).single();
    if (videoError) throw videoError;
    if (!video.audio_url) throw new Error('Vídeo sem audio_url — etapa de narração não terminou direito');

    const transcription = await transcribeWithWordTimestamps(video.audio_url);
    // verbose_json + timestamp_granularities=word retorna um array `words`
    // com { word, start, end } (em segundos) por palavra.
    const words = transcription.words || [];
    if (!words.length) throw new Error('Groq não retornou timestamps por palavra');

    await supabase
      .from('videos')
      .update({ captions_json: { words: words }, status: 'rendering', updated_at: new Date().toISOString() })
      .eq('id', videoId);

    await publishNextStep('/api/pipeline/render', { video_id: videoId });

    res.status(200).json({ ok: true });
  } catch (err) {
    await markVideoFailed(supabase, videoId, err.message);
    res.status(200).json({ ok: false });
  }
};
