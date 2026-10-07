const { getAuthenticatedUser } = require('./_lib/auth');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');

// Único e-mail que enxerga o painel admin. A checagem é SEMPRE aqui no
// servidor, em cima do token de sessão do Supabase (nunca confiar no front).
// Pode ser trocado por variável de ambiente sem mexer no código.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'belani.otavio@gmail.com').trim().toLowerCase();

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

// Pagina uma tabela inteira (o PostgREST limita 1000 linhas por request).
async function fetchAll(supabase, table, columns) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchAllAuthUsers(supabase) {
  const users = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page: page, perPage: PAGE_SIZE });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < PAGE_SIZE) break;
  }
  return users;
}

function earliest(map, key, iso) {
  if (!iso) return;
  if (!map[key] || iso < map[key]) map[key] = iso;
}

// Etapas do funil, na ordem. Todas derivadas de dados que o app já grava,
// exceto "checkout", que vem de funnel_events (gravado em
// create-checkout-session.js).
const STAGES = ['cadastro', 'confirmado', 'serie', 'video', 'pronto', 'checkout', 'assinou'];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

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
    if (!user.email || user.email.toLowerCase() !== ADMIN_EMAIL || !user.email_confirmed_at) {
      console.warn('[admin] Acesso negado para', user.email);
      res.status(403).json({ error: 'Acesso restrito' });
      return;
    }

    const supabase = getSupabaseAdmin();

    const [authUsers, seriesRows, videoRows, balances, subs] = await Promise.all([
      fetchAllAuthUsers(supabase),
      fetchAll(supabase, 'series', 'user_id, created_at'),
      fetchAll(supabase, 'videos', 'user_id, status, created_at, updated_at'),
      fetchAll(supabase, 'credit_balances', 'user_id, credits'),
      fetchAll(supabase, 'subscriptions', 'user_id, plan_id, billing_cycle, quantity, status, created_at'),
    ]);

    // funnel_events pode ainda não existir (migration manual) — nesse caso o
    // passo "checkout" cai no fallback (quem assinou obviamente passou por ele).
    let eventRows = [];
    const { data: ev, error: evError } = await supabase.from('funnel_events').select('user_id, event, created_at').limit(20000);
    if (!evError && ev) eventRows = ev;

    const per = {};
    function bucket(id) {
      if (!per[id]) per[id] = { seriesCount: 0, videosTotal: 0, videosReady: 0, failed: 0, t: {} };
      return per[id];
    }

    seriesRows.forEach(function (s) {
      const b = bucket(s.user_id);
      b.seriesCount++;
      earliest(b.t, 'serie', s.created_at);
    });
    videoRows.forEach(function (v) {
      const b = bucket(v.user_id);
      b.videosTotal++;
      earliest(b.t, 'video', v.created_at);
      if (v.status === 'ready') { b.videosReady++; earliest(b.t, 'pronto', v.updated_at || v.created_at); }
      if (v.status === 'failed') b.failed++;
    });
    eventRows.forEach(function (e) {
      if (e.event === 'checkout_started') earliest(bucket(e.user_id).t, 'checkout', e.created_at);
    });

    const creditsByUser = {};
    balances.forEach(function (b) { creditsByUser[b.user_id] = b.credits; });
    const subByUser = {};
    subs.forEach(function (s) { subByUser[s.user_id] = s; });

    const now = Date.now();
    const users = authUsers.map(function (u) {
      const b = per[u.id] || { seriesCount: 0, videosTotal: 0, videosReady: 0, failed: 0, t: {} };
      const sub = subByUser[u.id] || null;
      const subActive = !!sub && (sub.status === 'active' || sub.status === 'trialing');

      const t = Object.assign({}, b.t);
      t.cadastro = u.created_at;
      t.confirmado = u.email_confirmed_at || null;
      if (sub) {
        t.assinou = sub.created_at;
        if (!t.checkout) t.checkout = sub.created_at; // quem assinou passou pelo checkout
      }

      let stoppedAt = null;
      STAGES.forEach(function (st) { if (t[st]) stoppedAt = st; });

      const providers = (u.app_metadata && u.app_metadata.providers) || [];
      return {
        id: u.id,
        email: u.email,
        provider: providers.indexOf('google') !== -1 ? 'Google' : 'E-mail',
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at || null,
        credits: creditsByUser[u.id] != null ? creditsByUser[u.id] : 0,
        subscription: sub ? { planId: sub.plan_id, cycle: sub.billing_cycle, quantity: sub.quantity, status: sub.status, active: subActive } : null,
        seriesCount: b.seriesCount,
        videosTotal: b.videosTotal,
        videosReady: b.videosReady,
        videosFailed: b.failed,
        stages: t,
        stoppedAt: stoppedAt,
      };
    });
    users.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });

    function countSince(rows, ms) {
      const cutoff = new Date(now - ms).toISOString();
      return rows.filter(function (r) { return r.created_at >= cutoff; }).length;
    }
    function usersSince(field, ms) {
      const cutoff = new Date(now - ms).toISOString();
      return users.filter(function (u) { return u[field] && u[field] >= cutoff; }).length;
    }
    const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

    const funnelCounts = {};
    STAGES.forEach(function (st) {
      funnelCounts[st] = users.filter(function (u) { return !!u.stages[st]; }).length;
    });

    res.status(200).json({
      generatedAt: new Date(now).toISOString(),
      stages: STAGES,
      metrics: {
        videoRequests: {
          lastMinute: countSince(videoRows, MIN),
          lastHour: countSince(videoRows, HOUR),
          last24h: countSince(videoRows, DAY),
          last7d: countSince(videoRows, 7 * DAY),
          last30d: countSince(videoRows, 30 * DAY),
        },
        logins: {
          last24h: usersSince('lastSignInAt', DAY),
          last7d: usersSince('lastSignInAt', 7 * DAY),
          last30d: usersSince('lastSignInAt', 30 * DAY),
        },
        signups: {
          total: users.length,
          last24h: usersSince('createdAt', DAY),
          last7d: usersSince('createdAt', 7 * DAY),
          last30d: usersSince('createdAt', 30 * DAY),
        },
        activeSubscriptions: users.filter(function (u) { return u.subscription && u.subscription.active; }).length,
        videosReady: videoRows.filter(function (v) { return v.status === 'ready'; }).length,
        videosFailed: videoRows.filter(function (v) { return v.status === 'failed'; }).length,
        videosTotal: videoRows.length,
        funnelCounts: funnelCounts,
      },
      users: users,
    });
  } catch (err) {
    console.error('[admin] Falha inesperada:', err);
    res.status(500).json({ error: 'Falha inesperada no servidor: ' + err.message });
  }
};