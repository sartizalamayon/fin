-- =========================================================================
-- 0001_init.sql — canonical schema for the money-management app.
--
-- Mirrors src/lib/core/types.ts exactly. Rules that must not drift:
--   * Money is ALWAYS integer minor units (poisha) in BIGINT columns.
--     Never numeric, never float — reconciliation sums thousands of rows
--     and IEEE754 drift produces false mismatches.
--   * Enum types match the TS string unions member-for-member.
--   * Amounts are non-negative; the sign lives in `direction`.
--
-- This file is written to run BOTH on Supabase (where auth.uid() exists)
-- and on a plain local Postgres (where it does not — see the shim below).
-- Every statement is idempotent so it can be re-applied safely.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. auth.uid() shim
--
-- On Supabase, `auth.uid()` reads the sub claim of the request JWT and the
-- auth schema already exists — the block below is a no-op there.
--
-- On plain local Postgres there is no GoTrue, so we create a compatible
-- function that reads a session GUC instead. Server code sets it with
--   select set_config('app.user_id', '<uuid>', true)
-- (see withUser() in src/lib/db/client.ts), which makes the exact same RLS
-- policies enforceable locally.
--
-- NOTE: superusers and roles with BYPASSRLS ignore RLS entirely. Local dev
-- typically connects as a superuser, so RLS is inert there; that is why the
-- query layer ALSO filters on user_id explicitly. RLS is the backstop, not
-- the only guard.
-- -------------------------------------------------------------------------
create schema if not exists auth;

do $shim$
begin
  if to_regprocedure('auth.uid()') is null then
    execute $fn$
      create function auth.uid() returns uuid
      language sql
      stable
      as $body$
        select nullif(
          coalesce(
            current_setting('request.jwt.claim.sub', true),
            current_setting('app.user_id', true),
            ''
          ),
          ''
        )::uuid
      $body$;
    $fn$;
    comment on function auth.uid() is
      'Local-dev shim for Supabase auth.uid(). Reads the app.user_id GUC.';
  end if;
end
$shim$;

-- -------------------------------------------------------------------------
-- 1. Enum types — must match src/lib/core/types.ts exactly
-- -------------------------------------------------------------------------

-- PROVIDERS
do $$ begin
  create type public.provider as enum (
    'bkash', 'nagad', 'rocket', 'upay', 'bank', 'card', 'manual'
  );
exception when duplicate_object then null;
end $$;

-- DIRECTIONS: credit = money in, debit = money out
do $$ begin
  create type public.direction as enum ('credit', 'debit');
exception when duplicate_object then null;
end $$;

-- SOURCE_KINDS
do $$ begin
  create type public.source_kind as enum (
    'statement_pdf', 'email', 'sms', 'csv', 'manual'
  );
exception when duplicate_object then null;
end $$;

-- RECONCILE_STATUSES
do $$ begin
  create type public.reconcile_status as enum (
    'verified', 'failed', 'not_applicable', 'pending'
  );
exception when duplicate_object then null;
end $$;

-- CATEGORIES
do $$ begin
  create type public.category as enum (
    'food', 'transport', 'shopping', 'bills', 'health', 'education',
    'entertainment', 'salary', 'transfer', 'fees', 'cash', 'other'
  );
exception when duplicate_object then null;
end $$;

-- CURRENCIES
do $$ begin
  create type public.currency as enum ('BDT', 'USD', 'EUR', 'GBP', 'INR');
exception when duplicate_object then null;
end $$;

-- -------------------------------------------------------------------------
-- 2. Shared helpers
-- -------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -------------------------------------------------------------------------
-- 3. profiles
--
-- One row per authenticated user. `id` IS the user id — it matches
-- auth.uid() and is the parent of every other table's user_id. We do not add
-- a foreign key to auth.users so the same DDL applies on local Postgres,
-- where that table does not exist.
-- -------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key,
  email         text,
  display_name  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- 4. documents
--
-- An uploaded statement/export. We deliberately do NOT store the source PDF,
-- only its SHA-256 so re-uploads are rejected before any LLM call is made.
-- -------------------------------------------------------------------------
create table if not exists public.documents (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null
                           references public.profiles(id) on delete cascade,

  filename               text not null,
  -- SHA-256 hex of the uploaded bytes. Exactly 64 chars (DocumentSchema).
  file_hash              text not null,

  source_kind            public.source_kind not null,
  provider               public.provider not null,

  period_start           timestamptz,
  period_end             timestamptz,

  opening_balance_minor  bigint,
  closing_balance_minor  bigint,

  reconcile_status       public.reconcile_status not null default 'pending',
  -- Signed: computed closing - declared closing. May legitimately be negative.
  reconcile_delta_minor  bigint,

  row_count              integer not null default 0,
  created_at             timestamptz not null default now(),

  constraint documents_file_hash_len check (char_length(file_hash) = 64),
  constraint documents_row_count_nonneg check (row_count >= 0),
  constraint documents_period_order
    check (period_start is null or period_end is null or period_start <= period_end)
);

-- THE upload-dedup guarantee: the same bytes can never be ingested twice for
-- one user. Enforced before any LLM call, so a re-upload costs nothing.
create unique index if not exists documents_user_file_hash_key
  on public.documents (user_id, file_hash);

create index if not exists documents_user_created_at_idx
  on public.documents (user_id, created_at desc);

create index if not exists documents_user_period_idx
  on public.documents (user_id, period_start, period_end);

-- -------------------------------------------------------------------------
-- 5. transactions
--
-- The normalised row every ingestion source collapses into. Nothing
-- downstream knows which source produced it.
-- -------------------------------------------------------------------------
create table if not exists public.transactions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null
                          references public.profiles(id) on delete cascade,
  -- Null for rows that arrived outside a document (SMS, manual entry).
  document_id           uuid references public.documents(id) on delete cascade,

  occurred_at           timestamptz not null,
  -- Always positive; the sign lives in `direction`.
  amount_minor          bigint not null,
  direction             public.direction not null,
  currency              public.currency not null default 'BDT',

  -- Provider-issued transaction id (bKash TrxID etc). The strongest dedup key.
  ref_id                text,
  counterparty          text,
  description           text not null,

  provider              public.provider not null,
  -- Masked account/wallet identifier, e.g. "****4471". Never stored in full.
  account_ref           text,

  fee_minor             bigint not null default 0,
  balance_after_minor   bigint,

  category              public.category,

  -- Verbatim source text, kept so prompts can improve and rows be re-parsed
  -- without re-uploading.
  raw_text              text not null,

  -- Set when this row is one leg of an own-account transfer; nets to zero.
  -- FK added after transfer_pairs exists (mutual reference).
  transfer_pair_id      uuid,

  created_at            timestamptz not null default now(),

  constraint transactions_amount_nonneg check (amount_minor >= 0),
  constraint transactions_fee_nonneg check (fee_minor >= 0)
);

-- THE row-dedup guarantee. A provider ref id is unique per user per provider.
-- Partial, because refId is nullable in the domain type (SMS/manual rows).
-- insertTransactions() relies on this for ON CONFLICT DO NOTHING.
create unique index if not exists transactions_user_provider_ref_key
  on public.transactions (user_id, provider, ref_id)
  where ref_id is not null;

-- Dashboard: the default "recent transactions" ordering, and the driver of
-- every date-range scan.
create index if not exists transactions_user_occurred_at_idx
  on public.transactions (user_id, occurred_at desc);

-- Dashboard: category breakdown / donut chart.
create index if not exists transactions_user_category_idx
  on public.transactions (user_id, category);

-- Deleting or re-ingesting a document touches all its rows.
create index if not exists transactions_document_id_idx
  on public.transactions (document_id);

-- Fuzzy dedup (same day + same amount) when a provider ref id is absent.
create index if not exists transactions_user_occurred_amount_idx
  on public.transactions (user_id, occurred_at, amount_minor);

create index if not exists transactions_transfer_pair_idx
  on public.transactions (transfer_pair_id)
  where transfer_pair_id is not null;

-- -------------------------------------------------------------------------
-- 6. transfer_pairs
--
-- Links the two legs of an own-account move (bKash -> bank). Both legs stay
-- as transactions but net to zero for spend analysis.
-- -------------------------------------------------------------------------
create table if not exists public.transfer_pairs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null
                  references public.profiles(id) on delete cascade,

  out_leg_id    uuid not null
                  references public.transactions(id) on delete cascade,
  in_leg_id     uuid not null
                  references public.transactions(id) on delete cascade,

  amount_minor  bigint not null,
  -- Matcher confidence in [0,1]. NOT money, so a float is fine here.
  confidence    double precision not null default 1,
  created_at    timestamptz not null default now(),

  constraint transfer_pairs_amount_nonneg check (amount_minor >= 0),
  constraint transfer_pairs_confidence_range
    check (confidence >= 0 and confidence <= 1),
  constraint transfer_pairs_distinct_legs check (out_leg_id <> in_leg_id)
);

create unique index if not exists transfer_pairs_legs_key
  on public.transfer_pairs (out_leg_id, in_leg_id);

create index if not exists transfer_pairs_user_idx
  on public.transfer_pairs (user_id);

-- Close the mutual reference now that both tables exist.
do $$ begin
  alter table public.transactions
    add constraint transactions_transfer_pair_id_fkey
    foreign key (transfer_pair_id)
    references public.transfer_pairs(id) on delete set null;
exception when duplicate_object then null;
end $$;

-- -------------------------------------------------------------------------
-- 7. user_settings
--
-- Bring-your-own Groq key lives here, encrypted with AES-256-GCM by
-- src/lib/crypto/vault.ts. The ciphertext NEVER leaves the server; the API
-- returns only `groq_key_masked`.
-- -------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id               uuid primary key
                          references public.profiles(id) on delete cascade,

  -- AES-256-GCM envelope produced by encryptSecret(). Never returned to a
  -- client, never logged.
  groq_api_key_encrypted  text,
  -- Display-only, e.g. "gsk_••••••••4f2a". Safe to send to the browser.
  groq_key_masked         text,
  groq_key_set_at         timestamptz,

  default_currency        public.currency not null default 'BDT',
  timezone                text not null default 'Asia/Dhaka',
  monthly_budget_minor    bigint,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint user_settings_budget_nonneg
    check (monthly_budget_minor is null or monthly_budget_minor >= 0)
);

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 8. Row Level Security
--
-- The isolation primitive: a user can only ever touch rows whose user_id
-- equals auth.uid(). Separate policies per command so an INSERT can never
-- smuggle in someone else's user_id via a permissive USING clause.
--
-- Policies target the default role set (PUBLIC) rather than Supabase's
-- `authenticated` role, because that role does not exist on local Postgres.
-- auth.uid() returns NULL for anonymous callers, and `user_id = NULL` is
-- NULL (never true) — so anonymous access sees nothing.
-- =========================================================================

alter table public.profiles       enable row level security;
alter table public.documents      enable row level security;
alter table public.transactions   enable row level security;
alter table public.transfer_pairs enable row level security;
alter table public.user_settings  enable row level security;

-- --- profiles (the user id column is `id`) -------------------------------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own on public.profiles
  for delete using (id = auth.uid());

-- --- documents -----------------------------------------------------------
drop policy if exists documents_select_own on public.documents;
create policy documents_select_own on public.documents
  for select using (user_id = auth.uid());

drop policy if exists documents_insert_own on public.documents;
create policy documents_insert_own on public.documents
  for insert with check (user_id = auth.uid());

drop policy if exists documents_update_own on public.documents;
create policy documents_update_own on public.documents
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists documents_delete_own on public.documents;
create policy documents_delete_own on public.documents
  for delete using (user_id = auth.uid());

-- --- transactions --------------------------------------------------------
drop policy if exists transactions_select_own on public.transactions;
create policy transactions_select_own on public.transactions
  for select using (user_id = auth.uid());

drop policy if exists transactions_insert_own on public.transactions;
create policy transactions_insert_own on public.transactions
  for insert with check (user_id = auth.uid());

drop policy if exists transactions_update_own on public.transactions;
create policy transactions_update_own on public.transactions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists transactions_delete_own on public.transactions;
create policy transactions_delete_own on public.transactions
  for delete using (user_id = auth.uid());

-- --- transfer_pairs ------------------------------------------------------
drop policy if exists transfer_pairs_select_own on public.transfer_pairs;
create policy transfer_pairs_select_own on public.transfer_pairs
  for select using (user_id = auth.uid());

drop policy if exists transfer_pairs_insert_own on public.transfer_pairs;
create policy transfer_pairs_insert_own on public.transfer_pairs
  for insert with check (user_id = auth.uid());

drop policy if exists transfer_pairs_update_own on public.transfer_pairs;
create policy transfer_pairs_update_own on public.transfer_pairs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists transfer_pairs_delete_own on public.transfer_pairs;
create policy transfer_pairs_delete_own on public.transfer_pairs
  for delete using (user_id = auth.uid());

-- --- user_settings -------------------------------------------------------
drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own on public.user_settings
  for select using (user_id = auth.uid());

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own on public.user_settings
  for insert with check (user_id = auth.uid());

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own on public.user_settings
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_settings_delete_own on public.user_settings;
create policy user_settings_delete_own on public.user_settings
  for delete using (user_id = auth.uid());

-- =========================================================================
-- 9. Supabase-only: keep profiles in step with auth.users
--
-- Skipped entirely on local Postgres (no auth.users). Wrapped so a
-- permission error on a locked-down project degrades to a notice rather than
-- failing the whole migration.
-- =========================================================================
do $sync$
begin
  if to_regclass('auth.users') is null then
    return;
  end if;

  execute $fn$
    create or replace function public.handle_new_user() returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    begin
      insert into public.profiles (id, email)
      values (new.id, new.email)
      on conflict (id) do nothing;

      insert into public.user_settings (user_id)
      values (new.id)
      on conflict (user_id) do nothing;

      return new;
    end;
    $body$;
  $fn$;

  execute 'drop trigger if exists on_auth_user_created on auth.users';
  execute 'create trigger on_auth_user_created
             after insert on auth.users
             for each row execute function public.handle_new_user()';
exception when insufficient_privilege then
  raise notice 'skipping auth.users trigger: insufficient privilege';
end
$sync$;
