-- FluxReel — schema do backend de geração de vídeos
-- Rodar no SQL Editor do projeto Supabase (kbcagxxwhenqubbktsiv), uma vez.
-- Não depende de nenhuma migration tool — é só um script manual versionado aqui.

-- ============================================================
-- Tabelas
-- ============================================================

create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  niche text not null,
  language text not null default 'pt-BR',
  voice text not null,
  music text,
  style text not null,
  caption_style text not null,
  caption_font text not null default 'montserrat',
  glitch boolean not null default false,
  hook boolean not null default false,
  duration_bucket text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  plan_id text not null,
  billing_cycle text not null,
  quantity int not null default 1,
  status text not null,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta int not null,
  reason text not null,
  stripe_event_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  series_id uuid not null references public.series(id) on delete cascade,
  status text not null default 'queued',
  custom_prompt text,
  script jsonb,
  image_urls jsonb,
  audio_url text,
  captions_json jsonb,
  video_url text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists videos_user_id_idx on public.videos(user_id);
create index if not exists series_user_id_idx on public.series(user_id);

-- ============================================================
-- RLS — usuário só lê as próprias linhas. Toda escrita passa pelas
-- funções serverless usando a service_role key (que ignora RLS).
-- ============================================================

alter table public.series enable row level security;
alter table public.subscriptions enable row level security;
alter table public.credit_balances enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.videos enable row level security;

drop policy if exists "select own series" on public.series;
create policy "select own series" on public.series for select using (auth.uid() = user_id);

-- Usuário pode excluir a própria série direto do client (dashboard.html) —
-- series_id em videos é "on delete cascade", então os vídeos dela somem
-- junto (os arquivos no Storage não são limpos automaticamente).
drop policy if exists "delete own series" on public.series;
create policy "delete own series" on public.series for delete using (auth.uid() = user_id);

-- Idem pra excluir um vídeo individual (dashboard.html, aba Vídeos).
drop policy if exists "delete own videos" on public.videos;
create policy "delete own videos" on public.videos for delete using (auth.uid() = user_id);

drop policy if exists "select own subscriptions" on public.subscriptions;
create policy "select own subscriptions" on public.subscriptions for select using (auth.uid() = user_id);

drop policy if exists "select own credit_balances" on public.credit_balances;
create policy "select own credit_balances" on public.credit_balances for select using (auth.uid() = user_id);

drop policy if exists "select own credit_ledger" on public.credit_ledger;
create policy "select own credit_ledger" on public.credit_ledger for select using (auth.uid() = user_id);

drop policy if exists "select own videos" on public.videos;
create policy "select own videos" on public.videos for select using (auth.uid() = user_id);

-- Realtime — pro front escutar o campo `status` de `videos` mudar ao vivo
-- (usado na Fase 4, pra mostrar o vídeo assim que ficar pronto).
alter publication supabase_realtime add table public.videos;

-- ============================================================
-- Funções de crédito — únicas formas de alterar credit_balances.
-- security definer + execução restrita à service_role evita que um
-- usuário autenticado consiga chamar isso direto via supabase-js
-- (o client no front só tem a anon key).
-- ============================================================

create or replace function public.add_credits(p_user_id uuid, p_amount int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance int;
begin
  insert into public.credit_balances (user_id, credits, updated_at)
  values (p_user_id, p_amount, now())
  on conflict (user_id) do update
    set credits = public.credit_balances.credits + excluded.credits,
        updated_at = now()
  returning credits into new_balance;

  return new_balance;
end;
$$;

create or replace function public.debit_one_credit(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance int;
begin
  update public.credit_balances
    set credits = credits - 1,
        updated_at = now()
    where user_id = p_user_id and credits > 0
    returning credits into new_balance;

  return new_balance; -- null quando não havia crédito suficiente
end;
$$;

revoke all on function public.add_credits(uuid, int) from public, anon, authenticated;
revoke all on function public.debit_one_credit(uuid) from public, anon, authenticated;
grant execute on function public.add_credits(uuid, int) to service_role;
grant execute on function public.debit_one_credit(uuid) to service_role;

-- Usada pelo webhook da Stripe: grava o lançamento no ledger E credita o
-- saldo numa única transação (o corpo de uma função plpgsql já é atômico),
-- assim não existe um estado intermediário onde o evento fica marcado como
-- "processado" sem o saldo ter sido de fato atualizado.
-- Retorna true se creditou agora, false se esse stripe_event_id já tinha
-- sido processado antes (idempotência em cima do UNIQUE de credit_ledger).
create or replace function public.grant_subscription_credits(
  p_user_id uuid,
  p_amount int,
  p_reason text,
  p_stripe_event_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.credit_ledger (user_id, delta, reason, stripe_event_id)
  values (p_user_id, p_amount, p_reason, p_stripe_event_id);

  insert into public.credit_balances (user_id, credits, updated_at)
  values (p_user_id, p_amount, now())
  on conflict (user_id) do update
    set credits = public.credit_balances.credits + excluded.credits,
        updated_at = now();

  return true;
exception
  when unique_violation then
    return false;
end;
$$;

revoke all on function public.grant_subscription_credits(uuid, int, text, text) from public, anon, authenticated;
grant execute on function public.grant_subscription_credits(uuid, int, text, text) to service_role;
