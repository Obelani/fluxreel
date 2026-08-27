const { verifyQstashRequest } = require('./qstash');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', function (chunk) { chunks.push(chunk); });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

// Lê o corpo bruto da requisição do QStash, confirma que a assinatura é
// válida (prova que veio do QStash, não de qualquer um que descobriu a URL),
// e devolve o payload JSON já verificado.
async function readVerifiedQstashPayload(req) {
  const rawBody = await readRawBody(req);
  const bodyText = rawBody.toString('utf8');
  const valid = await verifyQstashRequest(req, bodyText);
  if (!valid) {
    throw new Error('Assinatura do QStash inválida');
  }
  return JSON.parse(bodyText);
}

// Marca o vídeo como falho e devolve o crédito gasto — o usuário não recebeu
// o vídeo, não faz sentido ele perder o crédito. Checa o status atual antes
// de devolver, pra não devolver duas vezes se por algum motivo essa função
// for chamada mais de uma vez pro mesmo vídeo.
async function markVideoFailed(supabase, videoId, message) {
  console.error('[pipeline] video', videoId, 'falhou:', message);

  const { data: video } = await supabase.from('videos').select('user_id, status').eq('id', videoId).maybeSingle();

  await supabase
    .from('videos')
    .update({ status: 'failed', error_message: String(message).slice(0, 2000), updated_at: new Date().toISOString() })
    .eq('id', videoId);

  if (video && video.status !== 'failed') {
    const { error: refundError } = await supabase.rpc('add_credits', { p_user_id: video.user_id, p_amount: 1 });
    if (refundError) console.error('[pipeline] Falha ao devolver crédito pro vídeo', videoId, refundError);
  }
}

module.exports = { readRawBody, readVerifiedQstashPayload, markVideoFailed };
