const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { markVideoFailed } = require('../_lib/pipelineStage');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', function (chunk) { chunks.push(chunk); });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

module.exports.config = { api: { bodyParser: false } };

// Recebe o callback da Creatomate quando o render termina. A forma exata do
// payload não está 100% confirmada (a documentação deles é renderizada em
// JS e não foi possível extrair o schema completo durante a pesquisa) — por
// isso logamos o payload bruto inteiro e tentamos reconhecer os campos mais
// prováveis (status/state, url/output_url/video_url). Ajustar aqui assim
// que virmos o formato real chegando, no primeiro teste de ponta a ponta.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const videoId = req.query && req.query.video_id;
  const rawBody = await readRawBody(req);
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    console.error('[render-webhook] Corpo não é JSON válido:', rawBody.toString('utf8').slice(0, 500));
    res.status(400).end();
    return;
  }

  console.log('[render-webhook] video_id=' + videoId + ' payload:', JSON.stringify(payload));

  if (!videoId) {
    console.error('[render-webhook] Sem video_id na query string — não dá pra saber qual vídeo atualizar.');
    res.status(400).end();
    return;
  }

  const supabase = getSupabaseAdmin();

  try {
    const { data: video } = await supabase.from('videos').select('status').eq('id', videoId).maybeSingle();
    if (!video || video.status !== 'rendering') {
      // Já processado antes (reentrega) ou vídeo em outro estado — no-op.
      res.status(200).json({ ok: true });
      return;
    }

    const item = Array.isArray(payload) ? payload[0] : payload;
    const status = item && (item.status || item.state);
    const videoUrl = item && (item.url || item.output_url || item.video_url);

    if (status === 'succeeded' || status === 'completed' || (videoUrl && !status)) {
      if (!videoUrl) throw new Error('Render marcado como concluído mas sem URL de vídeo no payload — ver log acima pro formato real');
      await supabase
        .from('videos')
        .update({ video_url: videoUrl, status: 'ready', updated_at: new Date().toISOString() })
        .eq('id', videoId);
    } else if (status === 'failed') {
      await markVideoFailed(supabase, videoId, (item && (item.error_message || item.error)) || 'Render falhou na Creatomate');
    } else {
      console.log('[render-webhook] Status ainda não terminal (' + status + ') — ignorando por enquanto.');
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[render-webhook] Erro processando callback:', err);
    res.status(500).json({ error: err.message });
  }
};
