const Stripe = require('stripe');
const { getAuthenticatedUser } = require('./_lib/auth');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');

// Cria uma sessão do Stripe Billing Portal — página hospedada pela própria
// Stripe onde o usuário troca cartão, cancela ou vê faturas, sem a gente
// precisar construir essa UI. Usado pelo botão "Gerenciar assinatura" no
// dashboard.
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

    const supabase = getSupabaseAdmin();
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (subError) throw subError;
    if (!subscription || !subscription.stripe_customer_id) {
      res.status(404).json({ error: 'Nenhuma assinatura encontrada' });
      return;
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = req.headers.origin || ('https://' + req.headers.host);
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: origin + '/dashboard.html',
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[create-portal-session] Falha inesperada:', err);
    res.status(500).json({ error: 'Falha inesperada no servidor: ' + err.message });
  }
};
