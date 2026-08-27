const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { readVerifiedQstashPayload, markVideoFailed } = require('../_lib/pipelineStage');
const { publishNextStep } = require('../_lib/qstash');
const { VOICE_IDS } = require('../_lib/pipelineConfig');

module.exports.config = { api: { bodyParser: false } };

// Nome do bucket público no Supabase Storage onde ficam os arquivos gerados
// (áudio de narração, e futuramente o vídeo final). Precisa existir e estar
// marcado como público — ver LEIA-ME/checklist de setup.
const STORAGE_BUCKET = 'media';

async function generateNarrationAudio(voiceId, text) {
  const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(function () { return ''; });
    throw new Error('ElevenLabs respondeu ' + res.status + ': ' + errText.slice(0, 500));
  }
  return Buffer.from(await res.arrayBuffer());
}

// Etapa 3: junta a narração de todas as cenas num único áudio (ElevenLabs),
// guarda no Supabase Storage.
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
    console.error('[pipeline/narration] Payload/assinatura inválida:', err.message);
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

    const voiceId = VOICE_IDS[video.series.voice];
    if (!voiceId) throw new Error('Voz "' + video.series.voice + '" sem voice_id configurado em api/_lib/pipelineConfig.js');

    const fullText = video.script.scenes.map(function (s) { return s.narration; }).join(' ');
    const audioBuffer = await generateNarrationAudio(voiceId, fullText);

    const storagePath = 'narration/' + videoId + '.mp3';
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg', upsert: true });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

    await supabase
      .from('videos')
      .update({ audio_url: publicUrlData.publicUrl, status: 'captions', updated_at: new Date().toISOString() })
      .eq('id', videoId);

    await publishNextStep('/api/pipeline/captions', { video_id: videoId });

    res.status(200).json({ ok: true });
  } catch (err) {
    await markVideoFailed(supabase, videoId, err.message);
    res.status(200).json({ ok: false });
  }
};
