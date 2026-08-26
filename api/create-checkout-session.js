const Stripe = require('stripe');
const { getAuthenticatedUser } = require('./_lib/auth');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getPriceId } = require('./_lib/plans');

// Cria a Checkout Session da Stripe (modo assinatura) pro plano escolhido
// no paywall. Chamado pelo botão "Assinar e criar minha série" em
// create-series.html. Os créditos só são liberados depois, no webhook,
// quando a Stripe confirmar o pagamento.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Não autenticado' });
    return;
  }

  const body = req.body || {};
  const priceId = getPriceId(body.plan_id, body.billing_cycle);
  if (!priceId) {
    res.status(400).json({ error: 'Plano ou ciclo de cobrança inválido' });
    return;
  }
  const quantity = Math.max(1, Math.min(10, parseInt(body.quantity, 10) || 1));
  const seriesId = body.series_id || '';

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = getSupabaseAdmin();

  // Reaproveita o Customer da Stripe se o usuário já assinou antes.
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  let customerId = existingSub && existingSub.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
  }

  const origin = req.headers.origin || ('https://' + req.headers.host);
  const metadata = {
    supabase_user_id: user.id,
    plan_id: body.plan_id,
    billing_cycle: body.billing_cycle,
    quantity: String(quantity),
    series_id: seriesId,
  };

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: quantity }],
      success_url: origin + '/create-series.html?success=1&series_id=' + encodeURIComponent(seriesId) + '&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/create-series.html?canceled=1',
      metadata: metadata,
      subscription_data: { metadata: metadata },
    });
  } catch (err) {
    console.error('[create-checkout-session] Erro criando sessão Stripe:', err);
    res.status(500).json({ error: 'Não foi possível iniciar o pagamento' });
    return;
  }

  res.status(200).json({ url: session.url });
};
