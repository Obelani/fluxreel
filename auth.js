/* ============================================================
   FluxReel — Autenticação (Supabase)
   ============================================================
   1) Cole abaixo a Project URL e a anon public key do seu projeto
      Supabase (Project Settings > API).
   2) Ative o provider Google em Authentication > Providers > Google
      e cole lá o Client ID / Client Secret gerados no Google Cloud
      Console (veja o passo a passo que te mandei no chat).
   3) Cole também o GOOGLE_CLIENT_ID abaixo (mesmo Client ID do passo
      2) — é usado direto no navegador (Google Identity Services)
      pro login não precisar redirecionar pelo domínio do Supabase.
   4) Esse arquivo precisa ser carregado DEPOIS do script do
      supabase-js E do script do Google (accounts.google.com/gsi/
      client). As páginas (index.html e login.html) já fazem isso na
      ordem certa — não mexe na ordem dos <script>.
================================================================ */

const SUPABASE_URL = 'https://kbcagxxwhenqubbktsiv.supabase.co'; // ex.: https://xxxxxxxx.supabase.co
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtiY2FneHh3aGVucXViYmt0c2l2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2OTE0NjUsImV4cCI6MjEwMzI2NzQ2NX0.OoTixD0NZshdE5oY7bY_0rP9ac3nYkMf9-EfYvZU7mE'; // ex.: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

// Client ID do OAuth Client "FluxReel" no Google Cloud Console (Aplicativo
// da Web) — Project Settings > APIs & Services > Credentials. Não é
// secreto (o Client Secret que seria, e esse nunca vai pro front), mas
// precisa ser o valor real pro login com Google funcionar via Google
// Identity Services (ver signInWithGoogle abaixo).
const GOOGLE_CLIENT_ID = '941118000754-7ipvcsjtnq6kuaggdpr4ddf86lvgtd3b.apps.googleusercontent.com';

// Para onde o usuário vai depois de logar com sucesso (Google ou e-mail/senha).
const REDIRECT_AFTER_LOGIN = '/create-series.html';

let _supabase = null;

function getSupabaseClient() {
  if (_supabase) return _supabase;

  if (typeof window.supabase === 'undefined') {
    console.error('[FluxReel] supabase-js não carregou. Confira se o <script src=".../supabase-js@2"> está antes de auth.js.');
    return null;
  }
  if (SUPABASE_URL.indexOf('COLE_AQUI') === 0 || SUPABASE_ANON_KEY.indexOf('COLE_AQUI') === 0) {
    console.warn('[FluxReel] Preencha SUPABASE_URL e SUPABASE_ANON_KEY em auth.js antes de usar o login.');
  }

  _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}

// ---------- Google (login e cadastro usam a mesma chamada) ----------
// redirectPath (opcional): pra onde voltar depois do Google. Se não passar
// nada, usa REDIRECT_AFTER_LOGIN. Usado pelo requireAuth() pra devolver o
// usuário pra página que ele tentou acessar antes de precisar logar.
//
// Fluxo principal: Google Identity Services (GSI) direto no navegador — o
// Google conversa com a própria página do FluxReel (não redireciona pro
// domínio do Supabase antes), e o ID token que ele devolve vai pro Supabase
// via signInWithIdToken(). Resultado: a tela de escolher conta do Google
// mostra "fluxreel.app", não "*.supabase.co".
// Se o GSI não conseguir mostrar nada (navegador bloqueando o prompt,
// script não carregado, etc.) cai automaticamente no fluxo antigo
// (signInWithOAuth, com redirect) — nunca deixa o usuário sem conseguir
// logar por causa disso.
let _googleRedirectPath = null;
let _googleRawNonce = null;

// O GSI precisa do nonce em SHA-256 hexadecimal, mas o Supabase precisa do
// nonce original (não hasheado) pra conferir contra o que veio dentro do
// id_token — sem os dois, signInWithIdToken rejeita com "Passed nonce and
// nonce in id_token should either both exist or not".
async function generateNonce() {
  const raw = btoa(String.fromCharCode.apply(null, crypto.getRandomValues(new Uint8Array(32))));
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(hashBuffer)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  return { raw: raw, hashed: hashed };
}

async function handleGoogleCredential(response) {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client.auth.signInWithIdToken({
    provider: 'google',
    token: response.credential,
    nonce: _googleRawNonce,
  });

  if (error) {
    console.error('[FluxReel] Erro ao entrar com Google (ID token):', error.message);
    alert('Não foi possível continuar com o Google. Tente novamente em instantes.');
    return;
  }
  window.location.href = window.location.origin + (_googleRedirectPath || REDIRECT_AFTER_LOGIN);
}

async function signInWithGoogleRedirectFallback(redirectPath) {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + (redirectPath || REDIRECT_AFTER_LOGIN),
    },
  });

  if (error) {
    console.error('[FluxReel] Erro ao entrar com Google:', error.message);
    alert('Não foi possível continuar com o Google. Tente novamente em instantes.');
  }
}

// ---------- Botão oficial do Google (quando o prompt automático não abre) ----------
// No celular o prompt do GSI (One Tap) quase nunca aparece, e o plano B antigo
// (redirect via Supabase) mostra "…supabase.co" na tela do Google. O botão
// oficial do GSI usa o MESMO caminho do desktop (ID token, sem redirect do
// Supabase) e a escolha de conta mostra "fluxreel.app". Então: no celular vai
// direto pra ele; no desktop só aparece se o prompt não abrir. O redirect do
// Supabase fica só como último recurso (GSI bloqueado/indisponível).
function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') ||
    !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
}

let _googleSheet = null;
function closeGoogleSheet() {
  if (_googleSheet && _googleSheet.parentNode) _googleSheet.parentNode.removeChild(_googleSheet);
  _googleSheet = null;
}

function showGoogleButtonSheet() {
  try {
    closeGoogleSheet();
    if (!document.getElementById('fr-gsi-style')) {
      const st = document.createElement('style');
      st.id = 'fr-gsi-style';
      st.textContent =
        '.fr-gsi-overlay{position:fixed;inset:0;z-index:400;background:rgba(5,6,12,.78);display:flex;align-items:center;justify-content:center;padding:16px;' +
          'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif}' +
        '.fr-gsi-card{position:relative;width:100%;max-width:360px;background:#11121c;border:1px solid #23253a;border-radius:20px;padding:26px 22px 24px;color:#fff;text-align:center}' +
        '.fr-gsi-card h3{margin:0 0 6px;font-size:18px}' +
        '.fr-gsi-card p{margin:0 0 18px;font-size:14px;color:#a8a8b8}' +
        '.fr-gsi-x{position:absolute;top:8px;right:10px;width:34px;height:34px;border:0;background:none;color:#a8a8b8;font-size:24px;line-height:1;cursor:pointer}' +
        '.fr-gsi-btn{display:flex;justify-content:center;min-height:44px}';
      document.head.appendChild(st);
    }
    const ov = document.createElement('div');
    ov.className = 'fr-gsi-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = '<div class="fr-gsi-card"><button type="button" class="fr-gsi-x" aria-label="Fechar">&times;</button>' +
      '<h3>Entrar com o Google</h3><p>Toque no botão para escolher sua conta.</p><div class="fr-gsi-btn" id="fr-gsi-btn"></div></div>';
    document.body.appendChild(ov);
    _googleSheet = ov;
    ov.addEventListener('click', function (e) { if (e.target === ov) closeGoogleSheet(); });
    ov.querySelector('.fr-gsi-x').addEventListener('click', closeGoogleSheet);
    const width = Math.min(300, Math.max(220, (window.innerWidth || 360) - 90));
    google.accounts.id.renderButton(ov.querySelector('#fr-gsi-btn'), {
      type: 'standard', theme: 'filled_black', size: 'large', shape: 'pill',
      text: 'continue_with', locale: 'pt-BR', logo_alignment: 'left', width: width,
    });
    return true;
  } catch (e) {
    console.error('[FluxReel] Não foi possível mostrar o botão do Google:', e);
    closeGoogleSheet();
    return false;
  }
}
async function signInWithGoogle(redirectPath) {
  _googleRedirectPath = redirectPath || REDIRECT_AFTER_LOGIN;

  if (typeof google === 'undefined' || !google.accounts || !google.accounts.id || GOOGLE_CLIENT_ID.indexOf('COLE_AQUI') === 0) {
    console.warn('[FluxReel] Google Identity Services indisponível — usando o fluxo de redirect.');
    signInWithGoogleRedirectFallback(redirectPath);
    return;
  }

  const nonce = await generateNonce();
  _googleRawNonce = nonce.raw;

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
    nonce: nonce.hashed,
  });
  if (isMobileDevice()) {
    // Celular: o prompt automático quase nunca abre — vai direto pro botão oficial.
    if (!showGoogleButtonSheet()) signInWithGoogleRedirectFallback(redirectPath);
    return;
  }
  google.accounts.id.prompt(function (notification) {
    var notShown = notification.isNotDisplayed && notification.isNotDisplayed();
    var skipped = notification.isSkippedMoment && notification.isSkippedMoment();
    if (notShown || skipped) {
      // Prompt não abriu: mostra o botão oficial (continua exibindo fluxreel.app).
      if (!showGoogleButtonSheet()) signInWithGoogleRedirectFallback(redirectPath);
    }
  });
}

// ---------- E-mail e senha ----------
async function signUpWithEmail(nome, email, senha, redirectPath, whatsapp) {
  const client = getSupabaseClient();
  if (!client) return { error: { message: 'Configuração do Supabase ausente.' } };

  const { data, error } = await client.auth.signUp({
    email: email,
    password: senha,
    options: {
      data: { full_name: nome, whatsapp: whatsapp || undefined, attribution: (window.FluxAttribution && window.FluxAttribution.get()) || undefined },
      emailRedirectTo: window.location.origin + (redirectPath || REDIRECT_AFTER_LOGIN),
    },
  });

  return { data, error };
}

async function signInWithEmail(email, senha) {
  const client = getSupabaseClient();
  if (!client) return { error: { message: 'Configuração do Supabase ausente.' } };

  const { data, error } = await client.auth.signInWithPassword({
    email: email,
    password: senha,
  });

  return { data, error };
}

// ---------- Sessão atual (útil pra outras páginas do site) ----------
async function getCurrentSession() {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session;
}

async function signOut() {
  const client = getSupabaseClient();
  if (!client) return;
  await client.auth.signOut();
  window.location.href = '/index.html';
}

// ---------- Proteção de páginas (só pra quem estiver logado) ----------
// Chame no topo de qualquer página que exige login (ex.: create-series.html).
// Se não houver sessão, manda o usuário pro login e guarda a página de
// destino em ?next=... pra voltar pra cá automaticamente depois de logar.
async function requireAuth() {
  const session = await getCurrentSession();
  if (!session) {
    var next = window.location.pathname + window.location.search;
    window.location.href = '/login.html?next=' + encodeURIComponent(next);
    return null;
  }
  return session;
}
