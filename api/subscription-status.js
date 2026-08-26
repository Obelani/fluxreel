const { getAuthenticatedUser } = require('./_lib/auth');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');

// Devolve a assinatura ativa do usuário (se tiver). Usado pelo paywall em
// create-series.html pra decidir entre mostrar "Assinar" normal ou o fluxo
// de troca de plano (usuário já é assinante).
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
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
    const { data, error } = await supabase
      .from('subscriptions')
      .select('plan_id, billing_cycle, quantity, status')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) throw error;

    const isActive = !!data && (data.status === 'active' || data.status === 'trialing');
    res.status(200).json({ subscription: isActive ? data : null });
  } catch (err) {
    console.error('[subscription-status] Falha inesperada:', err);
    res.status(500).json({ error: 'Falha inesperada no servidor: ' + err.message });
  }
};
