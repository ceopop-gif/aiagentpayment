-- AnnyPay Billing + AI Token System
-- Run after database/backoffice.sql and database/secrets.sql

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  monthly_fee numeric(12,2) not null check (monthly_fee >= 0),
  currency text not null default 'THB',
  monthly_ai_tokens bigint not null check (monthly_ai_tokens >= 0),
  features jsonb not null default '{}'::jsonb,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','ARCHIVED')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_subscriptions (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid not null unique references public.stores(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status text not null default 'PENDING' check (status in ('PENDING','TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED','EXPIRED')),
  billing_provider text,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  grace_until timestamptz,
  activated_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  subscription_id uuid not null references public.store_subscriptions(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'THB',
  status text not null default 'PENDING' check (status in ('DRAFT','PENDING','PAID','FAILED','VOID','REFUNDED')),
  billing_provider text,
  provider_invoice_id text,
  provider_payment_id text,
  payment_transaction_id uuid references public.payment_transactions(id) on delete set null,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subscription_id, period_start, period_end)
);

create table if not exists public.ai_token_wallets (
  store_id uuid primary key references public.stores(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  subscription_id uuid references public.store_subscriptions(id) on delete set null,
  monthly_granted bigint not null default 0 check (monthly_granted >= 0),
  monthly_used bigint not null default 0 check (monthly_used >= 0),
  monthly_remaining bigint not null default 0 check (monthly_remaining >= 0),
  topup_remaining bigint not null default 0 check (topup_remaining >= 0),
  period_start timestamptz,
  period_end timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_token_ledger (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  subscription_id uuid references public.store_subscriptions(id) on delete set null,
  entry_type text not null check (entry_type in ('MONTHLY_GRANT','MONTHLY_EXPIRE','AI_USAGE','TOPUP_PURCHASE','REFUND','ADJUSTMENT')),
  tokens_delta bigint not null,
  monthly_balance_after bigint not null default 0,
  topup_balance_after bigint not null default 0,
  source text,
  ref_type text,
  ref_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_usage_records (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  ai_action_id uuid references public.ai_actions(id) on delete set null,
  intent text,
  provider text,
  model text,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  total_tokens bigint not null check (total_tokens > 0),
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.token_packs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  token_amount bigint not null check (token_amount > 0),
  price numeric(12,2) not null check (price > 0),
  currency text not null default 'THB',
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','ARCHIVED')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.token_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  pack_id uuid not null references public.token_packs(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  token_amount bigint not null check (token_amount > 0),
  total_amount numeric(12,2) not null check (total_amount > 0),
  currency text not null default 'THB',
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','PAID','FAILED','CANCELLED','REFUNDED')),
  billing_provider text,
  provider_payment_id text,
  payment_transaction_id uuid references public.payment_transactions(id) on delete set null,
  tokens_granted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_token_purchase_provider_payment
  on public.token_purchase_orders(billing_provider, provider_payment_id)
  where provider_payment_id is not null;

create index if not exists idx_store_subscriptions_merchant on public.store_subscriptions(merchant_id, status);
create index if not exists idx_subscription_invoices_store on public.subscription_invoices(store_id, created_at desc);
create index if not exists idx_ai_token_ledger_store on public.ai_token_ledger(store_id, created_at desc);
create index if not exists idx_ai_usage_store on public.ai_usage_records(store_id, created_at desc);
create index if not exists idx_token_purchase_store on public.token_purchase_orders(store_id, created_at desc);

alter table public.subscription_plans enable row level security;
alter table public.store_subscriptions enable row level security;
alter table public.subscription_invoices enable row level security;
alter table public.ai_token_wallets enable row level security;
alter table public.ai_token_ledger enable row level security;
alter table public.ai_usage_records enable row level security;
alter table public.token_packs enable row level security;
alter table public.token_purchase_orders enable row level security;

create policy "read active subscription plans" on public.subscription_plans
for select using (status = 'ACTIVE');
create policy "read active token packs" on public.token_packs
for select using (status = 'ACTIVE');

create policy "merchant read subscriptions" on public.store_subscriptions
for select using (public.is_merchant_member(merchant_id));
create policy "merchant read subscription invoices" on public.subscription_invoices
for select using (public.is_merchant_member(merchant_id));
create policy "merchant read ai token wallets" on public.ai_token_wallets
for select using (public.is_merchant_member(merchant_id));
create policy "merchant read ai token ledger" on public.ai_token_ledger
for select using (public.is_merchant_member(merchant_id));
create policy "merchant read ai usage" on public.ai_usage_records
for select using (public.is_merchant_member(merchant_id));
create policy "merchant read token purchases" on public.token_purchase_orders
for select using (public.is_merchant_member(merchant_id));

-- Merchant-facing balance helper.
create or replace function public.get_store_ai_token_balance(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_wallet public.ai_token_wallets%rowtype;
  v_sub public.store_subscriptions%rowtype;
begin
  select * into v_store from public.stores where id = p_store_id;
  if v_store.id is null then raise exception 'Store not found'; end if;
  if not public.is_merchant_member(v_store.merchant_id) then raise exception 'Forbidden'; end if;

  select * into v_wallet from public.ai_token_wallets where store_id = p_store_id;
  select * into v_sub from public.store_subscriptions where store_id = p_store_id;

  return jsonb_build_object(
    'store_id', p_store_id,
    'subscription_status', coalesce(v_sub.status, 'NO_PLAN'),
    'period_start', v_wallet.period_start,
    'period_end', v_wallet.period_end,
    'monthly_granted', coalesce(v_wallet.monthly_granted, 0),
    'monthly_used', coalesce(v_wallet.monthly_used, 0),
    'monthly_remaining', coalesce(v_wallet.monthly_remaining, 0),
    'topup_remaining', coalesce(v_wallet.topup_remaining, 0),
    'total_remaining', coalesce(v_wallet.monthly_remaining, 0) + coalesce(v_wallet.topup_remaining, 0)
  );
end;
$$;

grant execute on function public.get_store_ai_token_balance(uuid) to authenticated;

-- Trusted backend only: atomically consume AI tokens, monthly pool first then top-up pool.
create or replace function public.consume_store_ai_tokens(
  p_store_id uuid,
  p_user_id uuid,
  p_total_tokens bigint,
  p_input_tokens bigint default 0,
  p_output_tokens bigint default 0,
  p_intent text default null,
  p_provider text default null,
  p_model text default null,
  p_source text default 'AI',
  p_ref_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.ai_token_wallets%rowtype;
  v_sub public.store_subscriptions%rowtype;
  v_monthly_use bigint;
  v_topup_use bigint;
begin
  if p_total_tokens is null or p_total_tokens <= 0 then raise exception 'Invalid token usage'; end if;

  select * into v_sub from public.store_subscriptions where store_id = p_store_id for update;
  if v_sub.id is null or v_sub.status not in ('ACTIVE','TRIAL') then
    raise exception 'SUBSCRIPTION_REQUIRED';
  end if;
  if v_sub.current_period_end is not null and v_sub.current_period_end <= now() then
    raise exception 'SUBSCRIPTION_EXPIRED';
  end if;

  select * into v_wallet from public.ai_token_wallets where store_id = p_store_id for update;
  if v_wallet.store_id is null then raise exception 'AI_TOKEN_WALLET_NOT_READY'; end if;
  if coalesce(v_wallet.monthly_remaining,0) + coalesce(v_wallet.topup_remaining,0) < p_total_tokens then
    raise exception 'INSUFFICIENT_AI_TOKENS';
  end if;

  v_monthly_use := least(v_wallet.monthly_remaining, p_total_tokens);
  v_topup_use := p_total_tokens - v_monthly_use;

  update public.ai_token_wallets
  set monthly_used = monthly_used + v_monthly_use,
      monthly_remaining = monthly_remaining - v_monthly_use,
      topup_remaining = topup_remaining - v_topup_use,
      updated_at = now()
  where store_id = p_store_id
  returning * into v_wallet;

  insert into public.ai_usage_records(
    merchant_id,store_id,user_id,intent,provider,model,input_tokens,output_tokens,total_tokens,source,metadata
  ) values (
    v_wallet.merchant_id,p_store_id,p_user_id,p_intent,p_provider,p_model,
    greatest(coalesce(p_input_tokens,0),0),greatest(coalesce(p_output_tokens,0),0),p_total_tokens,p_source,
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('ref_id',p_ref_id,'monthly_tokens_used',v_monthly_use,'topup_tokens_used',v_topup_use)
  );

  insert into public.ai_token_ledger(
    merchant_id,store_id,subscription_id,entry_type,tokens_delta,monthly_balance_after,topup_balance_after,source,ref_type,ref_id,metadata
  ) values (
    v_wallet.merchant_id,p_store_id,v_sub.id,'AI_USAGE',-p_total_tokens,v_wallet.monthly_remaining,v_wallet.topup_remaining,
    p_source,'AI_USAGE',p_ref_id,coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('intent',p_intent,'model',p_model)
  );

  return jsonb_build_object(
    'consumed', p_total_tokens,
    'monthly_used', v_monthly_use,
    'topup_used', v_topup_use,
    'monthly_remaining', v_wallet.monthly_remaining,
    'topup_remaining', v_wallet.topup_remaining,
    'total_remaining', v_wallet.monthly_remaining + v_wallet.topup_remaining
  );
end;
$$;

revoke all on function public.consume_store_ai_tokens(uuid,uuid,bigint,bigint,bigint,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.consume_store_ai_tokens(uuid,uuid,bigint,bigint,bigint,text,text,text,text,text,jsonb) to service_role;

-- Trusted backend only: monthly grant. Unused monthly quota expires; purchased top-up remains.
create or replace function public.grant_monthly_store_ai_tokens(
  p_subscription_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_ref_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.store_subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_wallet public.ai_token_wallets%rowtype;
  v_old_monthly bigint := 0;
begin
  select * into v_sub from public.store_subscriptions where id = p_subscription_id for update;
  if v_sub.id is null then raise exception 'Subscription not found'; end if;
  select * into v_plan from public.subscription_plans where id = v_sub.plan_id;
  if v_plan.id is null then raise exception 'Plan not found'; end if;

  select * into v_wallet from public.ai_token_wallets where store_id = v_sub.store_id for update;
  if v_wallet.store_id is not null then v_old_monthly := v_wallet.monthly_remaining; end if;

  insert into public.ai_token_wallets(
    store_id,merchant_id,subscription_id,monthly_granted,monthly_used,monthly_remaining,topup_remaining,period_start,period_end
  ) values (
    v_sub.store_id,v_sub.merchant_id,v_sub.id,v_plan.monthly_ai_tokens,0,v_plan.monthly_ai_tokens,coalesce(v_wallet.topup_remaining,0),p_period_start,p_period_end
  ) on conflict (store_id) do update set
    subscription_id=excluded.subscription_id,
    monthly_granted=excluded.monthly_granted,
    monthly_used=0,
    monthly_remaining=excluded.monthly_remaining,
    period_start=excluded.period_start,
    period_end=excluded.period_end,
    updated_at=now()
  returning * into v_wallet;

  if v_old_monthly > 0 then
    insert into public.ai_token_ledger(merchant_id,store_id,subscription_id,entry_type,tokens_delta,monthly_balance_after,topup_balance_after,source,ref_type,ref_id)
    values(v_sub.merchant_id,v_sub.store_id,v_sub.id,'MONTHLY_EXPIRE',-v_old_monthly,0,v_wallet.topup_remaining,'SUBSCRIPTION','PERIOD',p_ref_id);
  end if;

  insert into public.ai_token_ledger(merchant_id,store_id,subscription_id,entry_type,tokens_delta,monthly_balance_after,topup_balance_after,source,ref_type,ref_id)
  values(v_sub.merchant_id,v_sub.store_id,v_sub.id,'MONTHLY_GRANT',v_plan.monthly_ai_tokens,v_wallet.monthly_remaining,v_wallet.topup_remaining,'SUBSCRIPTION','PERIOD',p_ref_id);

  update public.store_subscriptions set
    status='ACTIVE',current_period_start=p_period_start,current_period_end=p_period_end,activated_at=coalesce(activated_at,now()),updated_at=now()
  where id=v_sub.id;

  return jsonb_build_object('store_id',v_sub.store_id,'monthly_tokens',v_plan.monthly_ai_tokens,'topup_tokens',v_wallet.topup_remaining,'period_end',p_period_end);
end;
$$;

revoke all on function public.grant_monthly_store_ai_tokens(uuid,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.grant_monthly_store_ai_tokens(uuid,timestamptz,timestamptz,text) to service_role;

-- Trusted backend only: grant purchased top-up exactly once.
create or replace function public.grant_token_topup(p_purchase_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase public.token_purchase_orders%rowtype;
  v_wallet public.ai_token_wallets%rowtype;
begin
  select * into v_purchase from public.token_purchase_orders where id=p_purchase_id for update;
  if v_purchase.id is null then raise exception 'Token purchase not found'; end if;
  if v_purchase.status <> 'PAID' then raise exception 'Token purchase is not paid'; end if;
  if v_purchase.tokens_granted_at is not null then
    select * into v_wallet from public.ai_token_wallets where store_id=v_purchase.store_id;
    return jsonb_build_object('already_granted',true,'total_remaining',coalesce(v_wallet.monthly_remaining,0)+coalesce(v_wallet.topup_remaining,0));
  end if;

  update public.ai_token_wallets set topup_remaining=topup_remaining+v_purchase.token_amount,updated_at=now()
  where store_id=v_purchase.store_id returning * into v_wallet;
  if v_wallet.store_id is null then raise exception 'AI token wallet not found'; end if;

  update public.token_purchase_orders set tokens_granted_at=now(),updated_at=now() where id=v_purchase.id;
  insert into public.ai_token_ledger(merchant_id,store_id,subscription_id,entry_type,tokens_delta,monthly_balance_after,topup_balance_after,source,ref_type,ref_id)
  values(v_purchase.merchant_id,v_purchase.store_id,v_wallet.subscription_id,'TOPUP_PURCHASE',v_purchase.token_amount,v_wallet.monthly_remaining,v_wallet.topup_remaining,'TOKEN_PURCHASE','TOKEN_PURCHASE',v_purchase.id::text);

  return jsonb_build_object('granted',v_purchase.token_amount,'monthly_remaining',v_wallet.monthly_remaining,'topup_remaining',v_wallet.topup_remaining,'total_remaining',v_wallet.monthly_remaining+v_wallet.topup_remaining);
end;
$$;

revoke all on function public.grant_token_topup(uuid) from public, anon, authenticated;
grant execute on function public.grant_token_topup(uuid) to service_role;
