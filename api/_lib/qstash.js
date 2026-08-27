const { Client, Receiver } = require('@upstash/qstash');

let _client = null;
function getQstashClient() {
  if (_client) return _client;
  if (!process.env.QSTASH_TOKEN) {
    throw new Error('QSTASH_TOKEN precisa estar configurado nas variáveis de ambiente.');
  }
  _client = new Client({ token: process.env.QSTASH_TOKEN });
  return _client;
}

// Publica a próxima etapa do pipeline. O QStash garante a entrega (com
// retry automático se a etapa de destino falhar/der timeout) — é o que
// mantém a cadeia roteiro -> imagens -> narração -> legendas -> render
// rodando de forma confiável a partir de functions serverless de vida curta.
async function publishNextStep(pathFromRoot, payload) {
  const origin = process.env.PUBLIC_BASE_URL;
  if (!origin) {
    throw new Error('PUBLIC_BASE_URL precisa estar configurado (ex.: https://www.fluxreel.com.br) para o QStash saber pra onde entregar.');
  }
  const client = getQstashClient();
  await client.publishJSON({
    url: origin + pathFromRoot,
    body: payload,
  });
}

// Verifica que a requisição recebida realmente veio do QStash (não de
// qualquer um que descobriu a URL) antes de processar qualquer coisa.
async function verifyQstashRequest(req, rawBody) {
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
  });
  const signature = req.headers['upstash-signature'];
  if (!signature) return false;
  try {
    return await receiver.verify({ signature, body: rawBody });
  } catch (err) {
    console.error('[qstash] Falha ao verificar assinatura:', err.message);
    return false;
  }
}

module.exports = { publishNextStep, verifyQstashRequest };
