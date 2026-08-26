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
    }
  } catch (err) {
    console.error('[stripe-webhook] Erro processando evento', event.type, err);
    res.status(500).send('Erro interno processando o evento');
    return;
  }

  res.status(200).json({ received: true });
};

async function handleSubscriptionActivated(supabase, stripe, event, info) {
  if (!info.userId || !info.planId || !info.billingCycle) {
    console.error('[stripe-webhook] Metadados ausentes no evento', event.id);
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(info.subscriptionId);

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
}
