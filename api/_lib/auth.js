const { getSupabaseAdmin } = require('./supabaseAdmin');

// Lê o "Authorization: Bearer <token>" que o front manda (token de sessão
// do Supabase, o mesmo que getCurrentSession() usa em auth.js) e resolve o
// usuário autenticado. Nunca confiar num user_id mandado pelo client.
async function getAuthenticatedUser(req) {
  const header = req.headers['authorization'] || req.headers['Authorization'];
  const token = header && header.indexOf('Bearer ') === 0 ? header.slice(7) : null;
  if (!token) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

module.exports = { getAuthenticatedUser };
