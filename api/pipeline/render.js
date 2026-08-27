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

// Um único elemento de texto cobrindo o vídeo inteiro, usando o recurso
// nativo de transcript da Creatomate (transcript_source + transcript_effect)
// — ela anima palavra por palavra sozinha (destaque/karaokê), sincronizada
// com os timestamps que já temos do Groq. Bem mais bonito e mais simples do
// que montar dezenas de blocos de texto manualmente.
function buildCaptionElement(words, style) {
  const transcriptSource = words.map(function (w) {
    return { time: w.start, duration: Math.max(w.end - w.start, 0.05), value: w.word };
  });

  const el = {
    type: 'text',
    track: 4,
    y: '78%',
    width: '85%',
    height: '30%',
    x_alignment: '50%',
    y_alignment: '50%',
    font_family: style.font_family || 'Arial',
    font_weight: style.font_weight,
    font_size: '7 vmin',
    fill_color: style.fill_color,
    transcript_effect: style.transcript_effect || 'highlight',
    transcript_color: style.transcript_color,
    transcript_maximum_length: 20,
    transcript_source: transcriptSource,
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
  return el;
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
    const captionStyle = CAPTION_STYLES[video.series.caption_style] || CAPTION_STYLES.classic;
    const captionElement = buildCaptionElement(words, captionStyle);

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
    elements.push(captionElement);

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
