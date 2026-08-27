const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { readVerifiedQstashPayload, markVideoFailed } = require('../_lib/pipelineStage');
const { publishNextStep } = require('../_lib/qstash');
const { STYLE_PROMPTS } = require('../_lib/pipelineConfig');

module.exports.config = { api: { bodyParser: false } };

async function generateImage(prompt) {
  const res = await fetch('https://fal.run/fal-ai/z-image/turbo', {
    method: 'POST',
    headers: {
      Authorization: 'Key ' + process.env.FAL_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: prompt,
      image_size: 'portrait_16_9', // vertical, formato de vídeo curto (9:16)
      num_images: 1,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(function () { return ''; });
    throw new Error('fal.ai respondeu ' + res.status + ': ' + text.slice(0, 500));
  }
  const data = await res.json();
  if (!data.images || !data.images[0]) throw new Error('fal.ai não retornou nenhuma imagem');
  return data.images[0].url;
}

// Etapa 2: gera uma imagem por cena (fal.ai / Z-Image Turbo), em paralelo.
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
    console.error('[pipeline/images] Payload/assinatura inválida:', err.message);
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

    const styleSuffix = STYLE_PROMPTS[video.series.style] || '';
    const scenes = video.script.scenes;

    const imageUrls = await Promise.all(
      scenes.map(function (scene) {
        const prompt = scene.visual + (styleSuffix ? ', ' + styleSuffix : '');
        return generateImage(prompt);
      })
    );

    await supabase
      .from('videos')
      .update({ image_urls: imageUrls, status: 'narration', updated_at: new Date().toISOString() })
      .eq('id', videoId);

    await publishNextStep('/api/pipeline/narration', { video_id: videoId });

    res.status(200).json({ ok: true });
  } catch (err) {
    await markVideoFailed(supabase, videoId, err.message);
    res.status(200).json({ ok: false });
  }
};
