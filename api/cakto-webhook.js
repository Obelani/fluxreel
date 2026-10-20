const crypto = require('crypto');
const Stripe = require('stripe');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getCaktoOffer, getCreditsForCycle } = require('./_lib/plans');

// A assinatura (HMAC) da Cakto é calculada sobre o corpo cru — por isso
// desligamos o bodyParser padrão da Vercel.
module.exports.config = {
  api: { bodyParser: false },
};

const TOLERANCE_SECONDS = 5 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', function (chunk) { chunks.push(chunk); });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

// Prova de origem. Preferência pela assinatura no header (HMAC-SHA256 de
// "<timestamp>.<corpo cru>"); se a entrega não trouxer os headers, cai no
// campo `secret` do corpo (a Cakto manda os dois).
function isFromCakto(req, rawBody, payload) {
  const secret = process.env.CAKTO_WEBHOOK_SECRET;
  if (!secret) return false;

  const timestamp = req.headers['x-cakto-timestamp'];
  const signature = req.headers['x-cakto-signature'];
  if (timestamp && signature) {
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
    const expected = 'v1=' + crypto.createHmac('sha256', secret).update(timestamp + '.').update(rawBody).digest('hex');
    return String(signature).split(',').some(function (part) { return safeEqual(part.trim(), expected); });
  }
  return safeEqual((payload && payload.secret) || '', secret);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const rawBody = await readRawBody(req);
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    res.status(400).send('JSON inválido');
    return;
  }

  if (!isFromCakto(req, rawBody, payload)) {
    console.error('[cakto-webhook] Origem/assinatura inválida');
    res.status(401).send('unauthorized');
    return;
  }

  const event = payload.event;
  let data = payload.data;
  // Webhook V2 entrega `data` como lista (todos os pedidos da cobrança) —
  // o que importa pra nós é o pedido principal.
  if (Array.isArray(data)) {
    data = data.find(function (o) { return o && o.offer_type === 'main'; }) || data[0];
  }
  if (!event || !data) {
    res.status(200).json({ received: true, ignored: 'sem event/data' });
    return;
  }

  const supabase = getSupabaseAdmin();

  // Idempotência por evento + pedido, ANTES de qualquer mutação (a Cakto
  // pode reentregar; reenvio manual de um evento que falhou também cai aqui,
  // porque claim_webhook_event deixa reprocessar o que está como 'failed').
  const eventKey = 'cakto:' + event + ':' + (data.id || ((data.customerEmail || '') + ':' + (data.createdAt || '')));
  const { data: shouldProcess, error: claimError } = await supabase.rpc('claim_webhook_event', {
    p_stripe_event_id: eventKey,
    p_type: 'cakto.' + event,
    p_event_created_at: new Date().toISOString(),
  });
  if (claimError) {
    console.error('[cakto-webhook] Falha ao registrar idempotência', eventKey, claimError);
    res.status(500).send('Erro interno');
    return;
  }
  if (!shouldProcess) {
    res.status(200).json({ received: true, skipped: true });
    return;
  }

  try {
    await dispatch(supabase, event, data);
    await supabase.rpc('finish_webhook_event', { p_stripe_event_id: eventKey, p_status: 'processed' });
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[cakto-webhook] Erro processando', event, eventKey, err);
    await supabase.rpc('finish_webhook_event', {
      p_stripe_event_id: eventKey,
      p_status: 'failed',
      p_error: String(err.message || err).slice(0, 2000),
    });
    // A Cakto NÃO reenvia sozinha em resposta não-2xx: o evento fica como
    // falha no histórico dela e se reprocessa pelo "Reenviar evento".
    res.status(500).send('Erro interno processando o evento');
  }
};

async function dispatch(supabase, event, data) {
  switch (event) {
    case 'purchase_approved':
    case 'subscription_renewed':
      await handlePaid(supabase, event, data);
      break;
    case 'refund_requested':
      // O comprador pediu reembolso: a intenção já está feita, então os
      // créditos daquele pagamento são retirados NA HORA (senão dá pra gastar
      // tudo gerando vídeo durante a janela de reembolso). Usa a mesma chave
      // do evento `refund` (por pedido), então a efetivação depois não
      // reverte uma segunda vez.
      await handleRevoke(supabase, data, 'refund', 'Reembolso solicitado (Cakto) — créditos retidos.');
      break;
    case 'refund':
      await handleRevoke(supabase, data, 'refund', 'Reembolso do pagamento (Cakto).');
      break;
    case 'chargeback':
      // O evento também dispara no pré-chargeback (alerta que ainda pode ser
      // defendido) — só reverte quando o pedido de fato virou chargeback.
      if (data.status === 'chargedback') {
        await handleRevoke(supabase, data, 'chargeback', 'Chargeback (Cakto).');
      } else {
        console.warn('[cakto-webhook] Alerta de chargeback (status', data.status + ') — nada revertido ainda, pedido', data.id);
      }
      break;
    case 'subscription_canceled':
      await setSubscriptionStatus(supabase, data, 'canceled');
      break;
    case 'subscription_late':
    case 'subscription_renewal_refused':
      await setSubscriptionStatus(supabase, data, 'past_due');
      break;
    case 'subscription_late_recovered':
    case 'subscription_resumed':
      await setSubscriptionStatus(supabase, data, 'active');
      break;
    case 'subscription_paused':
      await setSubscriptionStatus(supabase, data, 'paused');
      break;
    default:
      // Demais eventos (pix_gerado, boleto_gerado, checkout_abandonment...)
      // não mexem em saldo nem em assinatura.
      break;
  }
}

function subscriptionIdOf(data) {
  const sub = data.subscription;
  if (!sub) return null;
  if (typeof sub === 'string') return sub;
  return sub.id || sub.uuid || null;
}

// Quem comprou: o token ?callback=<id do usuário> que o front põe no link do
// checkout (volta no webhook). Fallback: o e-mail do comprador, caso o link
// tenha sido aberto sem o token.
async function resolveUserId(supabase, data) {
  const callback = data.callback;
  if (callback && UUID_RE.test(callback)) {
    const { data: found, error } = await supabase.auth.admin.getUserById(callback);
    if (!error && found && found.user) return found.user.id;
  }

  const email = ((data.customer && data.customer.email) || data.customerEmail || '').trim().toLowerCase();
  if (email) {
    for (let page = 1; page <= 20; page++) {
      const { data: list, error } = await supabase.auth.admin.listUsers({ page: page, perPage: 1000 });
      if (error) throw error;
      const match = list.users.find(function (u) { return (u.email || '').toLowerCase() === email; });
      if (match) return match.id;
      if (list.users.length < 1000) break;
    }
  }
  return null;
}

async function handlePaid(supabase, event, data) {
  const offer = getCaktoOffer(data.offer && data.offer.id);
  if (!offer) {
    console.warn('[cakto-webhook] Oferta fora do FluxReel (id', data.offer && data.offer.id + ') — ignorando pedido', data.id);
    return;
  }
  if (data.status !== 'paid') {
    console.warn('[cakto-webhook]', event, 'com status', data.status, '— não libera crédito, pedido', data.id);
    return;
  }

  const userId = await resolveUserId(supabase, data);
  if (!userId) {
    throw new Error('Comprador não encontrado (callback/e-mail) no pedido ' + data.id + ' — reprocessar pelo "Reenviar evento" depois de conferir a conta.');
  }

  const subId = subscriptionIdOf(data);

  // Se o usuário tinha assinatura ativa na Stripe, a nova (Cakto) substitui:
  // cancela a antiga só DEPOIS de registrar a nova, igual à troca de plano.
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('provider, stripe_subscription_id')
    .eq('user_id', userId)
    .maybeSingle();

  const days = offer.billingCycle === 'annual' ? 365 : 30;
  const paidAt = data.paidAt ? new Date(data.paidAt) : new Date();
  const { error: subError } = await supabase.from('subscriptions').upsert({
    user_id: userId,
    provider: 'cakto',
    external_subscription_id: subId,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    plan_id: offer.planId,
    billing_cycle: offer.billingCycle,
    quantity: 1,
    status: 'active',
    current_period_end: new Date(paidAt.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (subError) throw subError;

  // Um mesmo ciclo pode chegar como purchase_approved E subscription_renewed:
  // a chave é por assinatura+período, então só o primeiro concede.
  const periodKey = subId
    ? 'cakto:grant:' + subId + ':' + (data.subscription_period != null ? data.subscription_period : 'p0')
    : 'cakto:grant:order:' + data.id;
  const credits = getCreditsForCycle(offer.planId, offer.billingCycle, 1);
  const { error: creditError } = await supabase.rpc('grant_subscription_credits', {
    p_user_id: userId,
    p_amount: credits,
    p_reason: 'subscription_cycle',
    p_stripe_event_id: periodKey,
  });
  if (creditError) throw creditError;

  if (existing && existing.provider !== 'cakto' && existing.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
    try {
      await new Stripe(process.env.STRIPE_SECRET_KEY).subscriptions.cancel(existing.stripe_subscription_id);
    } catch (err) {
      console.error('[cakto-webhook] Não foi possível cancelar a assinatura antiga da Stripe', existing.stripe_subscription_id, err.message);
    }
  }
}

// Reembolso / chargeback: desfaz os créditos daquele ciclo (mesma quantidade
// que foi concedida). Chave por pedido => reentrega não reverte duas vezes.
async function handleRevoke(supabase, data, kind, reason) {
  const offer = getCaktoOffer(data.offer && data.offer.id);
  if (!offer) {
    console.warn('[cakto-webhook] Oferta fora do FluxReel — ignorando', kind, 'do pedido', data.id);
    return;
  }
  const userId = await resolveUserId(supabase, data);
  if (!userId) {
    throw new Error('Comprador não encontrado (callback/e-mail) no pedido ' + data.id);
  }

  const credits = getCreditsForCycle(offer.planId, offer.billingCycle, 1);
  const { data: reverted, error } = await supabase.rpc('revoke_credits_for_refund', {
    p_user_id: userId,
    p_amount: credits,
    p_reason: reason,
    p_stripe_event_id: 'cakto:' + kind + ':' + data.id,
  });
  if (error) throw error;
  console.warn('[cakto-webhook]', reverted ? 'Revertidos ' + credits + ' créditos' : 'Reversão já feita antes', '(', kind, ') pedido', data.id);
}

async function setSubscriptionStatus(supabase, data, status) {
  const subId = subscriptionIdOf(data);
  if (!subId) {
    console.warn('[cakto-webhook] Evento de assinatura sem id de assinatura — pedido', data.id);
    return;
  }
  const { error } = await supabase
    .from('subscriptions')
    .update({ status: status, updated_at: new Date().toISOString() })
    .eq('external_subscription_id', subId);
  if (error) throw error;
}