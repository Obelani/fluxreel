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
  custom_style text,
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

-- ============================================================
-- Reversão de crédito por reembolso/disputa perdida — espelha
-- grant_subscription_credits, mas subtrai. Nunca deixa o saldo negativo
-- (credits já gastos não têm como "voltar" fisicamente), mas o delta real
-- fica sempre registrado no ledger pra auditoria bater com o valor
-- correto mesmo quando o clamp em 0 aconteceu.
-- ============================================================
create or replace function public.revoke_credits_for_refund(
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
  values (p_user_id, -p_amount, p_reason, p_stripe_event_id);

  update public.credit_balances
    set credits = greatest(0, credits - p_amount),
        updated_at = now()
    where user_id = p_user_id;

  if not found then
    insert into public.credit_balances (user_id, credits, updated_at)
    values (p_user_id, 0, now());
  end if;

  return true;
exception
  when unique_violation then
    return false;
end;
$$;

revoke all on function public.revoke_credits_for_refund(uuid, int, text, text) from public, anon, authenticated;
grant execute on function public.revoke_credits_for_refund(uuid, int, text, text) to service_role;

-- Ledger append-only de verdade: nem o service_role consegue alterar/apagar
-- uma linha, independente de RLS ou GRANT explícito — histórico financeiro
-- nunca é reescrito, só cresce.
create or replace function public.forbid_credit_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'credit_ledger is append-only: % is not allowed', tg_op;
end;
$$;

drop trigger if exists credit_ledger_no_update on public.credit_ledger;
create trigger credit_ledger_no_update
  before update on public.credit_ledger
  for each row execute function public.forbid_credit_ledger_mutation();

drop trigger if exists credit_ledger_no_delete on public.credit_ledger;
create trigger credit_ledger_no_delete
  before delete on public.credit_ledger
  for each row execute function public.forbid_credit_ledger_mutation();

-- ============================================================
-- Idempotência de webhook — protege contra reentrega automática da Stripe
-- (que pode chegar horas/dias depois, ou concorrente) processar o mesmo
-- evento duas vezes. claim_webhook_event roda ANTES de qualquer mutação;
-- finish_webhook_event marca o resultado no final.
-- ============================================================
create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,
  type text not null,
  event_created_at timestamptz,
  received_at timestamptz not null default now(),
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed')),
  attempts integer not null default 1,
  internal_reference text,
  error text
);

alter table public.stripe_webhook_events enable row level security;
-- Sem nenhuma policy de select/insert/update pra anon/authenticated — só o
-- service_role (que ignora RLS) mexe nessa tabela; é puramente interna do
-- webhook, o usuário nunca precisa ler isso direto.

create or replace function public.claim_webhook_event(
  p_stripe_event_id text, p_type text, p_event_created_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform pg_advisory_xact_lock(hashtext(p_stripe_event_id));

  select status into v_status from public.stripe_webhook_events
    where stripe_event_id = p_stripe_event_id for update;

  if found then
    if v_status = 'processed' then return false; end if;
    update public.stripe_webhook_events
      set status = 'processing', attempts = attempts + 1, received_at = now()
      where stripe_event_id = p_stripe_event_id;
    return true;
  end if;

  insert into public.stripe_webhook_events (stripe_event_id, type, event_created_at, status)
    values (p_stripe_event_id, p_type, p_event_created_at, 'processing');
  return true;
end;
$$;

create or replace function public.finish_webhook_event(
  p_stripe_event_id text, p_status text, p_internal_reference text default null, p_error text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('processed', 'failed') then
    raise exception 'invalid status for finish_webhook_event: %', p_status;
  end if;
  update public.stripe_webhook_events
    set status = p_status, internal_reference = coalesce(p_internal_reference, internal_reference), error = p_error
    where stripe_event_id = p_stripe_event_id;
end;
$$;

revoke all on function public.claim_webhook_event(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.finish_webhook_event(text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_webhook_event(text, text, timestamptz) to service_role;
grant execute on function public.finish_webhook_event(text, text, text, text) to service_role;
