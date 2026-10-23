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
// exceto "checkout", que vem de funnel_events (gravado pelo front em
// goToCaktoCheckout, create-series.html / dashboard.html).
const STAGES = ['cadastro', 'confirmado', 'wizard', 'serie', 'video', 'pronto', 'checkout', 'assinou'];
const WIZARD_TOTAL_STEPS = 7;

// ---- Saldos das APIs que geram o material do lead -------------------------
// Só ElevenLabs e fal.ai têm consulta de saldo por API. Anthropic, Groq e
// QStash NÃO expõem saldo (só pelo console de cada um), então viram atalhos.
async function fetchTimeout(url, opts) {
  const ac = new AbortController();
  const t = setTimeout(function () { ac.abort(); }, 7000);
  try { return await fetch(url, Object.assign({}, opts, { signal: ac.signal })); } finally { clearTimeout(t); }
}

async function elevenLabsBalance() {
  const base = { id: 'elevenlabs', name: 'ElevenLabs', purpose: 'Narração', consoleUrl: 'https://elevenlabs.io/app/subscription' };
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return Object.assign(base, { ok: false, reason: 'Chave ELEVENLABS_API_KEY não configurada.' });
  try {
    const r = await fetchTimeout('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': key } });
    if (r.status === 401 || r.status === 403) {
      return Object.assign(base, { ok: false, reason: 'A chave não pode ler a assinatura. Em elevenlabs.io > API Keys, edite a chave e ative a permissão "User" (leitura).' });
    }
    if (!r.ok) return Object.assign(base, { ok: false, reason: 'ElevenLabs respondeu ' + r.status + '.' });
    const j = await r.json();
    const used = Number(j.character_count) || 0;
    const limit = Number(j.character_limit) || 0;
    return Object.assign(base, {
      ok: true,
      unit: 'caracteres',
      used: used,
      limit: limit,
      remaining: Math.max(0, limit - used),
      resetAt: j.next_character_count_reset_unix ? new Date(j.next_character_count_reset_unix * 1000).toISOString() : null,
      plan: j.tier || null,
    });
  } catch (err) {
    return Object.assign(base, { ok: false, reason: 'Falha ao consultar: ' + (err.name === 'AbortError' ? 'tempo esgotado' : err.message) });
  }
}

async function falBalance() {
  const base = { id: 'fal', name: 'fal.ai', purpose: 'Imagens', consoleUrl: 'https://fal.ai/dashboard/usage-billing/credits' };
  // A consulta de saldo da fal exige a permissão illing:usage:read, que vem nos
  // presets de chave BILLING (o mais restrito), READONLY ou FULL. Não use FULL se
  // puder evitar: é a chave que pode tudo. Aceita FAL_ADMIN_KEY por compatibilidade.
  const key = process.env.FAL_BILLING_KEY || process.env.FAL_ADMIN_KEY || process.env.FAL_KEY;
  if (!key) return Object.assign(base, { ok: false, reason: 'Chave FAL_KEY não configurada.' });
  try {
    const r = await fetchTimeout('https://api.fal.ai/v1/account/billing?expand=credits', { headers: { Authorization: 'Key ' + key } });
    if (r.status === 401 || r.status === 403) {
      return Object.assign(base, { ok: false, reason: 'A chave atual não pode ler o saldo. Crie uma chave com o preset Billing (ou Read-only) em fal.ai/dashboard/keys e salve na Vercel como FAL_BILLING_KEY.' });
    }
    if (!r.ok) return Object.assign(base, { ok: false, reason: 'fal.ai respondeu ' + r.status + '.' });
    const j = await r.json();
    const c = j && j.credits;
    if (!c || c.current_balance == null) return Object.assign(base, { ok: false, reason: 'Resposta sem o campo de saldo.' });
    return Object.assign(base, { ok: true, unit: 'saldo', balance: Number(c.current_balance), currency: c.currency || 'USD' });
  } catch (err) {
    return Object.assign(base, { ok: false, reason: 'Falha ao consultar: ' + (err.name === 'AbortError' ? 'tempo esgotado' : err.message) });
  }
}

function noApiProvider(id, name, purpose, consoleUrl) {
  return { id: id, name: name, purpose: purpose, consoleUrl: consoleUrl, ok: false, noApi: true, reason: 'Esse serviço não oferece consulta de saldo por API — veja no console.' };
}

async function getProviders() {
  const list = await Promise.all([elevenLabsBalance(), falBalance()]);
  list.push(noApiProvider('anthropic', 'Anthropic (Claude)', 'Roteiro e revisão', 'https://console.anthropic.com/settings/billing'));
  list.push(noApiProvider('groq', 'Groq (Whisper)', 'Legendas', 'https://console.groq.com/settings/billing'));
  list.push(noApiProvider('qstash', 'Upstash QStash', 'Fila do pipeline', 'https://console.upstash.com/qstash'));
  return { generatedAt: new Date().toISOString(), providers: list };
}
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

    // Saldos das APIs (aba APIs e saldos): chamada à parte pra não atrasar o resto.
    if (req.query && req.query.view === 'providers') {
      res.status(200).json(await getProviders());
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
    const { data: ev, error: evError } = await supabase.from('funnel_events').select('user_id, event, metadata, created_at').limit(20000);
    if (!evError && ev) eventRows = ev;

    const per = {};
    function bucket(id) {
      if (!per[id]) per[id] = { seriesCount: 0, videosTotal: 0, videosReady: 0, failed: 0, wizardStep: 0, t: {} };
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
      if (e.event === 'checkout_started') {
        earliest(bucket(e.user_id).t, 'checkout', e.created_at);
        const a = e.metadata && e.metadata.attribution;
        if (a && Object.keys(a).length) bucket(e.user_id).attrFromCheckout = a;
      }
      if (e.event === 'wizard_step') {
        const b = bucket(e.user_id);
        const step = e.metadata && parseInt(e.metadata.step, 10);
        if (step >= 1 && step <= WIZARD_TOTAL_STEPS && step > b.wizardStep) b.wizardStep = step;
        earliest(b.t, 'wizard', e.created_at);
      }
    });

    const creditsByUser = {};
    balances.forEach(function (b) { creditsByUser[b.user_id] = b.credits; });
    const subByUser = {};
    subs.forEach(function (s) { subByUser[s.user_id] = s; });

    const now = Date.now();
    const users = authUsers.map(function (u) {
      const b = per[u.id] || { seriesCount: 0, videosTotal: 0, videosReady: 0, failed: 0, wizardStep: 0, t: {} };
      const sub = subByUser[u.id] || null;
      const subActive = !!sub && (sub.status === 'active' || sub.status === 'trialing');

      const t = Object.assign({}, b.t);
      t.cadastro = u.created_at;
      t.confirmado = u.email_confirmed_at || null;
      // Quem já criou série obviamente passou por todo o wizard (cobre quem
      // se cadastrou antes de o registro de etapas existir).
      let wizardStep = b.wizardStep;
      if (!wizardStep && t.serie) { wizardStep = WIZARD_TOTAL_STEPS; t.wizard = t.serie; }
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
        name: (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || null,
        whatsapp: (u.user_metadata && u.user_metadata.whatsapp) || null,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at || null,
        credits: creditsByUser[u.id] != null ? creditsByUser[u.id] : 0,
        subscription: sub ? { planId: sub.plan_id, cycle: sub.billing_cycle, quantity: sub.quantity, status: sub.status, active: subActive } : null,
        seriesCount: b.seriesCount,
        videosTotal: b.videosTotal,
        videosReady: b.videosReady,
        videosFailed: b.failed,
        wizardStep: wizardStep,
        // Origem do anúncio (UTMs): do cadastro, ou do clique no checkout.
        attribution: (u.user_metadata && u.user_metadata.attribution) || b.attrFromCheckout || null,
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

    // Quantos usuários chegaram (no mínimo) até cada etapa do wizard.
    const wizardReach = [];
    for (let n = 1; n <= WIZARD_TOTAL_STEPS; n++) {
      wizardReach.push(users.filter(function (u) { return u.wizardStep >= n; }).length);
    }

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
        whatsappCollected: users.filter(function (u) { return !!u.whatsapp; }).length,
        videosReady: videoRows.filter(function (v) { return v.status === 'ready'; }).length,
        videosFailed: videoRows.filter(function (v) { return v.status === 'failed'; }).length,
        videosTotal: videoRows.length,
        funnelCounts: funnelCounts,
        wizardReach: wizardReach,
      },
      users: users,
    });
  } catch (err) {
    console.error('[admin] Falha inesperada:', err);
    res.status(500).json({ error: 'Falha inesperada no servidor: ' + err.message });
  }
};