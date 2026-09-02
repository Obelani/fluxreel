const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { readVerifiedQstashPayload, markVideoFailed } = require('../_lib/pipelineStage');
const { publishNextStep } = require('../_lib/qstash');
const { buildImagePrompt, validateImagePromptInput } = require('../_lib/imagePrompt');

module.exports.config = { api: { bodyParser: false } };

// Mesma seed reaproveitada em todas as cenas do vídeo. A fal.ai/z-image/
// turbo suporta `seed` de verdade (confirmado na doc da API) — não suporta
// negative_prompt nem imagem de referência, então isso é o único recurso
// real disponível pra puxar as gerações pra um "ponto de partida" comum,
// além do prompt em si carregar a mesma ficha de personagens/universo em
// toda cena (ver api/_lib/imagePrompt.js).
function seedFromVideoId(videoId) {
  let hash = 0;
  for (let i = 0; i < videoId.length; i++) {
    hash = (hash * 31 + videoId.charCodeAt(i)) | 0; // mantém em int32
  }
  return Math.abs(hash);
}

async function generateImage(prompt, seed) {
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
      seed: seed,
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

// Gera as imagens em lotes de até `concurrency` por vez, em vez de disparar
// tudo de uma vez — a conta do fal.ai tem limite de 10 requisições
// simultâneas, e um vídeo de 60-90s já tem até 11 cenas sozinho.
async function generateImagesLimited(prompts, seed, concurrency) {
  const results = new Array(prompts.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < prompts.length) {
      const i = nextIndex++;
      results[i] = await generateImage(prompts[i], seed);
    }
  }
  await Promise.all(new Array(Math.min(concurrency, prompts.length)).fill(0).map(worker));
  return results;
}

// Etapa 2: gera uma imagem por cena (fal.ai / Z-Image Turbo), com
// concorrência limitada. O prompt de cada cena é montado por
// buildImagePrompt() (api/_lib/imagePrompt.js) a partir do estilo visual
// da série + a ficha de personagens/universo que o Claude já definiu no
// roteiro (api/pipeline/script.js) — não monta prompt "na mão" aqui.
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

    const scenes = video.script.scenes;
    const characters = video.script.characters || [];
    const environment = video.script.environment || '';
    // Estilo específico pedido pra esse vídeo (dropdown do modal "Gerar
    // vídeo" no dashboard) tem prioridade sobre o estilo padrão da série.
    const selectedVisualStyle = video.custom_style || video.series.style;
    const seed = seedFromVideoId(videoId);

    const prompts = scenes.map(function (scene, i) {
      const presentIds = scene.charactersInScene || [];
      const characterBible = characters.filter(function (c) {
        return presentIds.indexOf(c.id) !== -1;
      });

      const promptInput = {
        sceneDescription: scene.visual,
        characterBible: characterBible,
        environmentBible: environment,
        selectedVisualStyle: selectedVisualStyle,
        aspectRatio: '9:16',
      };

      const warnings = validateImagePromptInput(promptInput);
      if (warnings.length) {
        console.warn('[pipeline/images] Cena ' + i + ' do vídeo ' + videoId + ' — avisos de validação:', warnings.join(' | '));
      }

      return buildImagePrompt(promptInput);
    });

    const imageUrls = await generateImagesLimited(prompts, seed, 4);

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
