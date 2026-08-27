-- AnnyPay Store Balance and Immutable Ledger
-- Run after database/payouts.sql

create table if not exists public.store_payout_policies (
  store_id uuid primary key references public.stores(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  currency text not null default 'THB',
  hold_minutes integer not null default 1440 check (hold_minutes >= 0),
  min_withdrawal numeric(14,2) not null default 1 check (min_withdrawal >= 0),
  max_withdrawal_per_request numeric(14,2),
  daily_withdrawal_limit numeric(14,2),
  manual_review_above numeric(14,2),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','PAUSED','SUSPENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_balances (
  store_id uuid primary key references public.stores(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  currency text not null default 'THB',
  pending_balance numeric(16,2) not null default 0 check (pending_balance >= 0),
  available_balance numeric(16,2) not null default 0 check (available_balance >= 0),
  reserved_balance numeric(16,2) not null default 0 check (reserved_balance >= 0),
  total_paid_in numeric(16,2) not null default 0 check (total_paid_in >= 0),
  total_fees numeric(16,2) not null default 0 check (total_fees >= 0),
  total_paid_out numeric(16,2) not null default 0 check (total_paid_out >= 0),
  total_refunded numeric(16,2) not null default 0 check (total_refunded >= 0),
  total_adjustments numeric(16,2) not null default 0,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.store_balance_ledger (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  currency text not null default 'THB',
  entry_type text not null check (entry_type in (
    'PAYMENT_CREDIT_PENDING','PAYMENT_RELEASE','PAYMENT_FEE','REFUND_DEBIT',
    'WITHDRAWAL_RESERVE','WITHDRAWAL_RELEASE','WITHDRAWAL_PAID',
    'CHARGEBACK_DEBIT','ADJUSTMENT'
  )),
  amount numeric(16,2) not null check (amount >= 0),
  pending_delta numeric(16,2) not null default 0,
  available_delta numeric(16,2) not null default 0,
  reserved_delta numeric(16,2) not null default 0,
  paid_out_delta numeric(16,2) not null default 0,
  pending_after numeric(16,2) not null,
  available_after numeric(16,2) not null,
  reserved_after numeric(16,2) not null,
  paid_out_after numeric(16,2) not null,
  source_type text not null,
  source_id uuid,
  source_ref text,
  idempotency_key text not null unique,
  available_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_balance_ledger_store_created on public.store_balance_ledger(store_id, created_at desc);
create index if not exists idx_balance_ledger_source on public.store_balance_ledger(source_type, source_id, entry_type);

alter table public.withdrawal_requests
  add column if not exists risk_status text not null default 'PENDING'
    check (risk_status in ('PENDING','PASS','REVIEW','BLOCKED')),
  add column if not exists risk_flags jsonb not null default '[]'::jsonb,
  add column if not exists reserved_at timestamptz,
  add column if not exists submitted_at timestamptz,
  add column if not exists released_at timestamptz;

alter table public.store_payout_policies enable row level security;
alter table public.store_balances enable row level security;
alter table public.store_balance_ledger enable row level security;

create policy "merchant read payout policy" on public.store_payout_policies for select using (public.is_merchant_member(merchant_id));
create policy "merchant read store balance" on public.store_balances for select using (public.is_merchant_member(merchant_id));
create policy "merchant read store balance ledger" on public.store_balance_ledger for select using (public.is_merchant_member(merchant_id));

create or replace function public.prevent_store_balance_ledger_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'STORE_BALANCE_LEDGER_IMMUTABLE';
end;
$$;

drop trigger if exists trg_store_balance_ledger_no_update on public.store_balance_ledger;
create trigger trg_store_balance_ledger_no_update before update or delete on public.store_balance_ledger for each row execute function public.prevent_store_balance_ledger_mutation();

comment on table public.store_balances is 'Current store money buckets: pending, available, reserved, and cumulative paid out.';
comment on table public.store_balance_ledger is 'Immutable audit ledger for every store balance movement.';
