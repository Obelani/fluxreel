const { createClient } = require('@supabase/supabase-js');

let _client = null;

// Client server-side com a service_role key — só usado dentro das
// functions em /api, nunca exposto ao front (que continua usando só
// a anon key já configurada em auth.js).
function getSupabaseAdmin() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configurados nas variáveis de ambiente da Vercel.');
  }

  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}

module.exports = { getSupabaseAdmin };
