-- AnnyPay Store Payout Accounts + Withdrawal Requests
-- Rule: each store may register at most 5 payout accounts.
-- Withdrawals can be sent ONLY to a verified ACTIVE payout account belonging to that store.
-- Full bank account numbers must be encrypted/stored by the trusted server via Secret Store.

create table if not exists public.payout_accounts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  bank_code text not null,
  bank_name text not null,
  account_name text not null,
  account_number_ref text not null,
  account_number_last4 text not null check (length(account_number_last4) between 2 and 4),
  account_fingerprint text not null,
  account_type text,
  status text not null default 'PENDING_VERIFICATION'
    check (status in ('PENDING_VERIFICATION','VERIFIED','ACTIVE','DISABLED','REJECTED','REMOVED')),
  verification_method text,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  available_for_withdrawal_at timestamptz,
  is_default boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  unique(store_id, account_fingerprint)
);

create index if not exists idx_payout_accounts_store_status
  on public.payout_accounts(store_id, status, created_at desc);

-- Hard limit: maximum 5 registered payout accounts per store.
-- REMOVED accounts no longer occupy a slot; all other statuses do.
create or replace function public.enforce_store_payout_account_limit()
returns trigger
language plpgsql
as $$
declare
  v_count integer;
begin
  if new.status = 'REMOVED' then
    return new;
  end if;

  select count(*) into v_count
  from public.payout_accounts pa
  where pa.store_id = new.store_id
    and pa.status <> 'REMOVED'
    and (tg_op = 'INSERT' or pa.id <> new.id);

  if v_count >= 5 then
    raise exception 'STORE_PAYOUT_ACCOUNT_LIMIT_REACHED';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_store_payout_account_limit on public.payout_accounts;
create trigger trg_store_payout_account_limit
before insert or update of store_id, status on public.payout_accounts
for each row execute function public.enforce_store_payout_account_limit();

-- A store can have at most one default payout account.
create unique index if not exists uq_store_default_payout_account
  on public.payout_accounts(store_id)
  where is_default = true and status <> 'REMOVED';

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  withdrawal_ref text not null unique,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  payout_account_id uuid not null references public.payout_accounts(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  fee numeric(14,2) not null default 0 check (fee >= 0),
  net_amount numeric(14,2) not null check (net_amount >= 0),
  currency text not null default 'THB',
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED','REVIEWING','APPROVED','PROCESSING','PAID','FAILED','REJECTED','CANCELLED','HELD')),
  bank_code_snapshot text not null,
  bank_name_snapshot text not null,
  account_name_snapshot text not null,
  account_last4_snapshot text not null,
  account_fingerprint_snapshot text not null,
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  provider text,
  provider_payout_id text,
  provider_status text,
  paid_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_withdrawal_store_requested
  on public.withdrawal_requests(store_id, requested_at desc);
create index if not exists idx_withdrawal_merchant_status
  on public.withdrawal_requests(merchant_id, status, requested_at desc);
create index if not exists idx_withdrawal_provider_payout
  on public.withdrawal_requests(provider, provider_payout_id)
  where provider_payout_id is not null;

-- Database-level guard: withdrawal destination must be the selected store's ACTIVE verified account.
create or replace function public.validate_withdrawal_destination()
returns trigger
language plpgsql
as $$
declare
  v_account public.payout_accounts%rowtype;
begin
  select * into v_account
  from public.payout_accounts
  where id = new.payout_account_id
  for share;

  if v_account.id is null then
    raise exception 'PAYOUT_ACCOUNT_NOT_FOUND';
  end if;
  if v_account.merchant_id <> new.merchant_id or v_account.store_id <> new.store_id then
    raise exception 'PAYOUT_ACCOUNT_STORE_MISMATCH';
  end if;
  if v_account.status <> 'ACTIVE' or v_account.verified_at is null then
    raise exception 'PAYOUT_ACCOUNT_NOT_VERIFIED_ACTIVE';
  end if;
  if v_account.available_for_withdrawal_at is not null and v_account.available_for_withdrawal_at > now() then
    raise exception 'PAYOUT_ACCOUNT_NOT_YET_AVAILABLE';
  end if;

  new.bank_code_snapshot := v_account.bank_code;
  new.bank_name_snapshot := v_account.bank_name;
  new.account_name_snapshot := v_account.account_name;
  new.account_last4_snapshot := v_account.account_number_last4;
  new.account_fingerprint_snapshot := v_account.account_fingerprint;
  return new;
end;
$$;

drop trigger if exists trg_validate_withdrawal_destination on public.withdrawal_requests;
create trigger trg_validate_withdrawal_destination
before insert or update of payout_account_id, store_id, merchant_id
on public.withdrawal_requests
for each row execute function public.validate_withdrawal_destination();

-- Withdrawal destination snapshot is immutable after request creation.
create or replace function public.lock_withdrawal_destination_snapshot()
returns trigger
language plpgsql
as $$
begin
  if old.merchant_id is distinct from new.merchant_id
     or old.store_id is distinct from new.store_id
     or old.payout_account_id is distinct from new.payout_account_id
     or old.bank_code_snapshot is distinct from new.bank_code_snapshot
     or old.bank_name_snapshot is distinct from new.bank_name_snapshot
     or old.account_name_snapshot is distinct from new.account_name_snapshot
     or old.account_last4_snapshot is distinct from new.account_last4_snapshot
     or old.account_fingerprint_snapshot is distinct from new.account_fingerprint_snapshot
     or old.amount is distinct from new.amount
     or old.currency is distinct from new.currency
  then
    raise exception 'WITHDRAWAL_REQUEST_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_withdrawal_destination_snapshot on public.withdrawal_requests;
create trigger trg_lock_withdrawal_destination_snapshot
before update on public.withdrawal_requests
for each row execute function public.lock_withdrawal_destination_snapshot();

-- RLS
alter table public.payout_accounts enable row level security;
alter table public.withdrawal_requests enable row level security;

create policy "merchant read payout accounts" on public.payout_accounts
for select using (public.is_merchant_member(merchant_id));

create policy "merchant read withdrawals" on public.withdrawal_requests
for select using (public.is_merchant_member(merchant_id));

-- Writes for payout accounts and withdrawals go through trusted backend only.
-- Browser-side insert/update/delete policies are intentionally NOT created.

comment on table public.payout_accounts is
'Up to five registered payout destinations per store. Full account number is referenced from encrypted server-side Secret Store.';
comment on table public.withdrawal_requests is
'Immutable withdrawal request snapshot. Funds may be sent only to the selected verified ACTIVE payout account for the same store.';
