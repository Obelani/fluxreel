/* ============================================================
   FluxReel — Autenticação (Supabase)
   ============================================================
   1) Cole abaixo a Project URL e a anon public key do seu projeto
      Supabase (Project Settings > API).
   2) Ative o provider Google em Authentication > Providers > Google
      e cole lá o Client ID / Client Secret gerados no Google Cloud
      Console (veja o passo a passo que te mandei no chat).
   3) Esse arquivo precisa ser carregado DEPOIS do script do
      supabase-js. As duas páginas (index.html e login.html) já
      fazem isso na ordem certa — não mexe na ordem dos <script>.
================================================================ */

const SUPABASE_URL = 'https://kbcagxxwhenqubbktsiv.supabase.co'; // ex.: https://xxxxxxxx.supabase.co
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtiY2FneHh3aGVucXViYmt0c2l2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2OTE0NjUsImV4cCI6MjEwMzI2NzQ2NX0.OoTixD0NZshdE5oY7bY_0rP9ac3nYkMf9-EfYvZU7mE'; // ex.: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

// Para onde o usuário vai depois de logar com sucesso (Google ou e-mail/senha).
// Troque para a página do seu painel/app quando ela existir.
const REDIRECT_AFTER_LOGIN = '/create-series.html';

let _supabase = null;

function getSupabaseClient() {
  if (_supabase) return _supabase;

  if (typeof window.supabase === 'undefined') {
    console.error('[FluxReel] supabase-js não carregou. Confira se o <script src=".../supabase-js@2"> está antes de auth.js.');
    return null;
  }
  if (SUPABASE_URL.indexOf('https://kbcagxxwhenqubbktsiv.supabase.co') === 0 || SUPABASE_ANON_KEY.indexOf('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtiY2FneHh3aGVucXViYmt0c2l2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2OTE0NjUsImV4cCI6MjEwMzI2NzQ2NX0.OoTixD0NZshdE5oY7bY_0rP9ac3nYkMf9-EfYvZU7mE') === 0) {
    console.warn('[FluxReel] Preencha SUPABASE_URL e SUPABASE_ANON_KEY em auth.js antes de usar o login.');
  }

  _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}

// ---------- Google (login e cadastro usam a mesma chamada) ----------
async function signInWithGoogle() {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + REDIRECT_AFTER_LOGIN,
    },
  });

  if (error) {
    console.error('[FluxReel] Erro ao entrar com Google:', error.message);
    alert('Não foi possível continuar com o Google. Tente novamente em instantes.');
  }
  // Em caso de sucesso o Google redireciona a página inteira — não tem
  // mais nada pra fazer aqui, a sessão volta pronta no redirectTo acima.
}

// ---------- E-mail e senha ----------
async function signUpWithEmail(nome, email, senha) {
  const client = getSupabaseClient();
  if (!client) return { error: { message: 'Configuração do Supabase ausente.' } };

  const { data, error } = await client.auth.signUp({
    email: email,
    password: senha,
    options: {
      data: { full_name: nome },
      emailRedirectTo: window.location.origin + REDIRECT_AFTER_LOGIN,
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
