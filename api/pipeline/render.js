const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { readVerifiedQstashPayload, markVideoFailed } = require('../_lib/pipelineStage');
const { CAPTION_STYLES } = require('../_lib/pipelineConfig');

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

// Etapa 5: manda a composição (imagens + narração + música + legenda) pro
// serviço de render (Revideo, self-hosted no Fly.io — ver render-service/).
// Diferente da Creatomate, esse serviço não chama nenhum webhook de volta:
// ele mesmo sobe o MP4 pro Supabase Storage e atualiza a linha em `videos`
// direto, usando a service_role key. Essa function só dispara a chamada e
// retorna — o status do vídeo continua 'rendering' até lá.
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

    const sceneDurations = buildSceneDurations(video.script.scenes, totalDuration);
    const musicUrl = video.series.music
      ? process.env.BASE_URL + '/music/' + video.series.music + '.mp3'
      : null;
    const style = CAPTION_STYLES[video.series.caption_style] || CAPTION_STYLES.classic;

    const renderRes = await fetch(process.env.RENDER_SERVICE_URL + '/render', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.RENDER_SERVICE_SECRET,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        video_id: videoId,
        image_urls: video.image_urls,
        scene_durations: sceneDurations,
        audio_url: video.audio_url,
        music_url: musicUrl,
        words: words,
        style: style,
      }),
    });

    if (!renderRes.ok) {
      const errText = await renderRes.text().catch(function () { return ''; });
      throw new Error('render-service respondeu ' + renderRes.status + ': ' + errText.slice(0, 800));
    }

    console.log('[pipeline/render] Render disparado pra vídeo', videoId, 'no render-service.');

    res.status(200).json({ ok: true });
  } catch (err) {
    await markVideoFailed(supabase, videoId, err.message);
    res.status(200).json({ ok: false });
  }
};
