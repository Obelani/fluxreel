const Stripe = require('stripe');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getCreditsForCycle } = require('./_lib/plans');

// A verificação de assinatura da Stripe precisa do corpo bruto (bytes),
// não do JSON já parseado — por isso desligamos o bodyParser padrão da Vercel.
module.exports.config = {
  api: { bodyParser: false },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', function (chunk) { chunks.push(chunk); });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[stripe-webhook] Assinatura inválida:', err.message);
    res.status(400).send('Webhook signature inválida');
    return;
  }

  const supabase = getSupabaseAdmin();

  // Idempotência geral por event.id, ANTES de qualquer mutação — protege
  // contra reentrega automática da Stripe (chega de novo horas/dias depois)
  // e contra duas entregas concorrentes do mesmo evento. Separado da
  // idempotência específica de crédito que já existia em
  // grant_subscription_credits (unique em credit_ledger.stripe_event_id) —
  // essa aqui cobre TODO tipo de evento, não só concessão de crédito.
  const { data: shouldProcess, error: claimError } = await supabase.rpc('claim_webhook_event', {
    p_stripe_event_id: event.id,
    p_type: event.type,
    p_event_created_at: new Date(event.created * 1000).toISOString(),
  });
  if (claimError) {
    console.error('[stripe-webhook] Falha ao registrar idempotência do evento', event.id, claimError);
    res.status(500).send('Erro interno');
    return;
  }
  if (!shouldProcess) {
    console.log('[stripe-webhook] Evento', event.id, 'já processado antes — ignorando reentrega.');
    res.status(200).json({ received: true, skipped: true });
    return;
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await handleSubscriptionActivated(supabase, stripe, event, {
        customerId: session.customer,
        subscriptionId: session.subscription,
        userId: session.metadata && session.metadata.supabase_user_id,
        planId: session.metadata && session.metadata.plan_id,
        billingCycle: session.metadata && session.metadata.billing_cycle,
        quantity: parseInt((session.metadata && session.metadata.quantity) || '1', 10),
      });
    } else if (event.type === 'invoice.paid') {
      const invoice = event.data.object;
      // "subscription_cycle" = renovação. A primeira cobrança já é tratada
      // em checkout.session.completed — sem esse filtro creditaríamos 2x.
      if (invoice.billing_reason === 'subscription_cycle' && invoice.subscription) {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        await handleSubscriptionActivated(supabase, stripe, event, {
          customerId: invoice.customer,
          subscriptionId: invoice.subscription,
          userId: subscription.metadata && subscription.metadata.supabase_user_id,
          planId: subscription.metadata && subscription.metadata.plan_id,
          billingCycle: subscription.metadata && subscription.metadata.billing_cycle,
          quantity: parseInt((subscription.metadata && subscription.metadata.quantity) || '1', 10),
        });
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      await supabase
        .from('subscriptions')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('stripe_subscription_id', subscription.id);
    } else if (event.type === 'charge.refunded') {
      await handleChargeRefunded(supabase, stripe, event.data.object);
    } else if (event.type === 'charge.dispute.closed') {
      await handleDisputeClosed(supabase, stripe, event.data.object);
    }
    // Outros tipos de evento: nenhuma ação (a Stripe não exige resposta por
    // tipo). Os tipos realmente tratados são só os do if/else acima — o
    // endpoint no Dashboard da Stripe deve ter EXATAMENTE esses cadastrados:
    // checkout.session.completed, invoice.paid, customer.subscription.deleted,
    // charge.refunded, charge.dispute.closed.

    await supabase.rpc('finish_webhook_event', { p_stripe_event_id: event.id, p_status: 'processed' });
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[stripe-webhook] Erro processando evento', event.type, event.id, err);
    await supabase.rpc('finish_webhook_event', {
      p_stripe_event_id: event.id,
      p_status: 'failed',
      p_error: String(err.message || err).slice(0, 2000),
    });
    // Erro real (não de negócio) — 500 faz a Stripe reentregar depois.
    res.status(500).send('Erro interno processando o evento');
  }
};

async function handleSubscriptionActivated(supabase, stripe, event, info) {
  if (!info.userId || !info.planId || !info.billingCycle) {
    console.error('[stripe-webhook] Metadados ausentes no evento', event.id);
    return;
  }

  // A Stripe reentrega automaticamente eventos que falharam antes, por horas
  // ou dias — independente de reenvio manual. Sem essa checagem, um evento
  // antigo reentregue fora de ordem reativa uma assinatura já superada e
  // cancela a que está realmente ativa agora. Checar isso ANTES de qualquer
  // outra coisa (não só na concessão de crédito) evita esse replay bagunçar
  // o registro de qual assinatura é a atual.
  const { data: alreadyProcessed } = await supabase
    .from('credit_ledger')
    .select('id')
    .eq('stripe_event_id', event.id)
    .maybeSingle();
  if (alreadyProcessed) {
    console.log('[stripe-webhook] Evento', event.id, 'já processado antes — ignorando reentrega.');
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(info.subscriptionId);

  // Se o usuário já tinha uma assinatura ativa diferente dessa (troca de
  // plano), guarda o id antigo antes do upsert sobrescrever — só cancela
  // ela depois de confirmar que a nova está ativa e os créditos foram
  // concedidos, pra nunca deixar o usuário sem nenhuma no meio do caminho.
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('user_id', info.userId)
    .maybeSingle();
  const previousSubscriptionId =
    existingSub && existingSub.stripe_subscription_id !== info.subscriptionId
      ? existingSub.stripe_subscription_id
      : null;

  await supabase.from('subscriptions').upsert({
    user_id: info.userId,
    stripe_customer_id: info.customerId,
    stripe_subscription_id: info.subscriptionId,
    plan_id: info.planId,
    billing_cycle: info.billingCycle,
    quantity: info.quantity,
    status: subscription.status,
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });

  // grant_subscription_credits grava o ledger e credita o saldo numa única
  // transação no Postgres — evita o estado intermediário de "evento marcado
  // como processado, mas saldo não atualizado" caso algo falhe no meio.
  const creditsToGrant = getCreditsForCycle(info.planId, info.billingCycle, info.quantity);
  const { error: creditError } = await supabase.rpc('grant_subscription_credits', {
    p_user_id: info.userId,
    p_amount: creditsToGrant,
    p_reason: 'subscription_cycle',
    p_stripe_event_id: event.id,
  });
  if (creditError) throw creditError;

  // Só cancela a assinatura anterior depois que a nova já está confirmada
  // e os créditos concedidos — troca de plano, não perda de acesso.
  if (previousSubscriptionId) {
    try {
      await stripe.subscriptions.cancel(previousSubscriptionId);
    } catch (err) {
      // Pode já ter sido cancelada antes (reentrega do mesmo evento) — não é fatal.
      console.error('[stripe-webhook] Não foi possível cancelar assinatura anterior', previousSubscriptionId, err.message);
    }
  }
}

// Reembolso — só reverte crédito em reembolso TOTAL da charge (regra: nunca
// reverte automático em reembolso parcial, fica pra revisão manual). Relê a
// charge direto da Stripe em vez de confiar só no payload do evento, pra
// sempre calcular sobre o valor acumulado mais atual.
async function handleChargeRefunded(supabase, stripe, chargeFromEvent) {
  const charge = await stripe.charges.retrieve(chargeFromEvent.id);

  if (!charge.refunded && charge.amount_refunded < charge.amount) {
    console.warn(
      '[stripe-webhook] Reembolso parcial na charge', charge.id,
      '(', charge.amount_refunded, '/', charge.amount, ') — revisão manual necessária, nenhum crédito revertido automaticamente.'
    );
    return;
  }

  await revokeCreditsForCharge(supabase, stripe, charge, 'refund:' + charge.id, 'Reembolso total do pagamento.');
}

// Disputa (chargeback) perdida = mesmo efeito de um reembolso total: o
// dinheiro saiu, os créditos daquele ciclo precisam voltar. Disputa
// ganha/pendente não faz nada.
async function handleDisputeClosed(supabase, stripe, dispute) {
  if (dispute.status !== 'lost') return;

  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id;
  const charge = await stripe.charges.retrieve(chargeId);

  await revokeCreditsForCharge(supabase, stripe, charge, 'dispute:' + charge.id, 'Disputa (chargeback) perdida.');
}

// Reverte os créditos concedidos pelo ciclo de assinatura ao qual essa
// charge pertence. Recalcula a quantidade pelo mesmo getCreditsForCycle
// usado na concessão (plan_id/billing_cycle/quantity vêm dos metadados da
// própria subscription, gravados na criação do checkout) — não depende de
// achar a linha exata do ledger que concedeu, então funciona mesmo que o
// evento de concessão original nunca tenha sido processado por algum motivo.
async function revokeCreditsForCharge(supabase, stripe, charge, idempotencyKey, reason) {
  if (!charge.invoice) {
    console.warn('[stripe-webhook] Charge', charge.id, 'sem invoice associada — não é uma cobrança de assinatura, nada a reverter.');
    return;
  }
  const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice.id;
  const invoice = await stripe.invoices.retrieve(invoiceId);
  if (!invoice.subscription) {
    console.warn('[stripe-webhook] Invoice', invoiceId, 'sem subscription associada — nada a reverter.');
    return;
  }

  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription.id;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const meta = subscription.metadata || {};
  if (!meta.supabase_user_id || !meta.plan_id || !meta.billing_cycle) {
    console.error('[stripe-webhook] Assinatura', subscriptionId, 'sem metadados esperados — não é possível calcular quantos créditos reverter.');
    return;
  }

  const quantity = parseInt(meta.quantity || '1', 10);
  const creditsToRevoke = getCreditsForCycle(meta.plan_id, meta.billing_cycle, quantity);
  if (!creditsToRevoke) return;

  const { data: reverted, error } = await supabase.rpc('revoke_credits_for_refund', {
    p_user_id: meta.supabase_user_id,
    p_amount: creditsToRevoke,
    p_reason: reason,
    p_stripe_event_id: idempotencyKey,
  });
  if (error) throw error;
  if (reverted) {
    console.warn('[stripe-webhook] Revertidos', creditsToRevoke, 'créditos do usuário', meta.supabase_user_id, '(' + reason + ')');
  } else {
    console.log('[stripe-webhook] Reversão', idempotencyKey, 'já tinha sido processada antes — ignorando.');
  }
}
