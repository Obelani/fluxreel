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
// mostra "fluxreel.com.br", não "*.supabase.co".
// Se o GSI não conseguir mostrar nada (navegador bloqueando o prompt,
// script não carregado, etc.) cai automaticamente no fluxo antigo
// (signInWithOAuth, com redirect) — nunca deixa o usuário sem conseguir
// logar por causa disso.
let _googleRedirectPath = null;

async function handleGoogleCredential(response) {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client.auth.signInWithIdToken({
    provider: 'google',
    token: response.credential,
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

async function signInWithGoogle(redirectPath) {
  _googleRedirectPath = redirectPath || REDIRECT_AFTER_LOGIN;

  if (typeof google === 'undefined' || !google.accounts || !google.accounts.id || GOOGLE_CLIENT_ID.indexOf('COLE_AQUI') === 0) {
    console.warn('[FluxReel] Google Identity Services indisponível — usando o fluxo de redirect.');
    signInWithGoogleRedirectFallback(redirectPath);
    return;
  }

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
  });
  google.accounts.id.prompt(function (notification) {
    var notShown = notification.isNotDisplayed && notification.isNotDisplayed();
    var skipped = notification.isSkippedMoment && notification.isSkippedMoment();
    if (notShown || skipped) {
      signInWithGoogleRedirectFallback(redirectPath);
    }
  });
}

// ---------- E-mail e senha ----------
async function signUpWithEmail(nome, email, senha, redirectPath) {
  const client = getSupabaseClient();
  if (!client) return { error: { message: 'Configuração do Supabase ausente.' } };

  const { data, error } = await client.auth.signUp({
    email: email,
    password: senha,
    options: {
      data: { full_name: nome },
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
