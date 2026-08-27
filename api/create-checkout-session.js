const Stripe = require('stripe');
const { getAuthenticatedUser } = require('./_lib/auth');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getPriceId } = require('./_lib/plans');

// Só páginas conhecidas do próprio site — nunca usar um valor de
// return_path sem checar contra essa lista (evita redirect aberto através
// da Checkout Session da Stripe).
const ALLOWED_RETURN_PATHS = ['/create-series.html', '/dashboard'];

// Cria a Checkout Session da Stripe (modo assinatura) pro plano escolhido
// no paywall — chamado tanto pelo wizard (create-series.html, ao criar a
// primeira série) quanto pelo dashboard (botão "Upgrade", reativando uma
// assinatura pra uma conta que já tem série). Os créditos só são liberados
// depois, no webhook, quando a Stripe confirmar o pagamento.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  try {
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
    const returnPath = ALLOWED_RETURN_PATHS.indexOf(body.return_path) !== -1 ? body.return_path : '/create-series.html';

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

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: quantity }],
      success_url: origin + returnPath + '?success=1' + (seriesId ? '&series_id=' + encodeURIComponent(seriesId) : '') + '&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: origin + returnPath + '?canceled=1',
      metadata: metadata,
      subscription_data: { metadata: metadata },
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[create-checkout-session] Falha inesperada:', err);
    res.status(500).json({ error: 'Falha inesperada no servidor: ' + err.message });
  }
};
