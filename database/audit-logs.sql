-- AnnyPay Unified Activity / Security / Audit Logs
-- Run after all commerce, payment, billing, payout and balance migrations.
-- One append-only log stream covers Frontend, Backoffice, API, AI, Payment,
-- Webhook, Billing, Payout and Database changes.

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique default ('LOG_' || replace(gen_random_uuid()::text, '-', '')),
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),

  event_name text not null,
  event_category text not null default 'ACTIVITY',
  severity text not null default 'INFO'
    check (severity in ('DEBUG','INFO','NOTICE','WARN','ERROR','CRITICAL')),
  source_area text not null default 'SYSTEM'
    check (source_area in (
      'AUTH','FRONTEND','BACKOFFICE','API','DATABASE','AI','PAYMENT',
      'PAYOUT','BILLING','WEBHOOK','SECURITY','SYSTEM'
    )),
  actor_type text not null default 'SYSTEM'
    check (actor_type in ('USER','CUSTOMER','ANONYMOUS','AI','SYSTEM','PROVIDER')),

  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email_snapshot text,
  session_key text,

  merchant_id uuid references public.merchants(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,

  request_id text,
  trace_id text,
  route text,
  http_method text,
  http_status integer,
  success boolean,
  duration_ms integer,

  resource_type text,
  resource_id text,
  action text,
  message text,

  ip_hash text,
  user_agent text,
  referer text,
  client_timestamp timestamptz,

  metadata jsonb not null default '{}'::jsonb,
  before_data jsonb,
  after_data jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_activity_logs_merchant_time
  on public.activity_logs(merchant_id, occurred_at desc);
create index if not exists idx_activity_logs_store_time
  on public.activity_logs(store_id, occurred_at desc);
create index if not exists idx_activity_logs_actor_time
  on public.activity_logs(actor_user_id, occurred_at desc);
create index if not exists idx_activity_logs_event_time
  on public.activity_logs(event_name, occurred_at desc);
create index if not exists idx_activity_logs_request
  on public.activity_logs(request_id)
  where request_id is not null;
create index if not exists idx_activity_logs_session
  on public.activity_logs(session_key, occurred_at desc)
  where session_key is not null;
create index if not exists idx_activity_logs_severity_time
  on public.activity_logs(severity, occurred_at desc);

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  session_key text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  email_snapshot text,
  merchant_id uuid references public.merchants(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  login_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  logout_at timestamptz,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','LOGGED_OUT','EXPIRED','REVOKED')),
  login_source text,
  ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_sessions_user_time
  on public.user_sessions(user_id, login_at desc);
create index if not exists idx_user_sessions_merchant_status
  on public.user_sessions(merchant_id, status, last_seen_at desc);
create index if not exists idx_user_sessions_active
  on public.user_sessions(status, last_seen_at desc);

alter table public.activity_logs enable row level security;
alter table public.user_sessions enable row level security;

drop policy if exists "merchant read activity logs" on public.activity_logs;
create policy "merchant read activity logs" on public.activity_logs
for select using (
  actor_user_id = auth.uid()
  or (merchant_id is not null and public.is_merchant_member(merchant_id))
);

drop policy if exists "merchant read user sessions" on public.user_sessions;
create policy "merchant read user sessions" on public.user_sessions
for select using (
  user_id = auth.uid()
  or (merchant_id is not null and public.is_merchant_member(merchant_id))
);

-- Browser writes are intentionally not allowed.
-- Trusted backend/service-role and SECURITY DEFINER audit triggers write records.

create or replace function public.prevent_activity_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ACTIVITY_LOG_APPEND_ONLY';
end;
$$;

drop trigger if exists trg_activity_logs_append_only on public.activity_logs;
create trigger trg_activity_logs_append_only
before update or delete on public.activity_logs
for each row execute function public.prevent_activity_log_mutation();

create or replace function public.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
as $$
begin
  if p_value is null or p_value = '' then return null; end if;
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.audit_source_for_table(p_table text)
returns text
language sql
immutable
as $$
  select case
    when p_table like 'payment_%' or p_table in ('refunds','settlements') then 'PAYMENT'
    when p_table like 'payout_%' or p_table like 'withdrawal_%'
      or p_table like 'store_balance%' or p_table = 'store_payout_policies' then 'PAYOUT'
    when p_table like 'ai_%' or p_table = 'content_assets' then 'AI'
    when p_table like 'subscription_%' or p_table like 'token_%' then 'BILLING'
    when p_table like 'webhook_%' or p_table in ('inbound_events','system_events') then 'WEBHOOK'
    else 'DATABASE'
  end
$$;

create or replace function public.sanitize_audit_row(p_table text, p_data jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v jsonb := coalesce(p_data, '{}'::jsonb);
begin
  -- Global secret/credential fields.
  v := v - array[
    'password','password_hash','secret','token','access_token','refresh_token',
    'api_key','private_key','service_role_key','webhook_secret',
    'account_number_ref','account_fingerprint','signing_secret_ref',
    'ciphertext','iv','auth_tag'
  ];

  -- Table-specific data minimization.
  if p_table in ('customers','profiles') then
    v := v - array['phone','email','shipping_address','metadata'];
  end if;
  if p_table = 'orders' then
    v := v - array['shipping_address'];
  end if;
  if p_table = 'payment_transactions' then
    v := v - array['raw_provider_data','provider_metadata','qr_payload','shipping_address_snapshot'];
  end if;
  if p_table in ('payment_webhooks','inbound_events') then
    v := v - array['payload','normalized_event','raw_provider_data'];
  end if;
  if p_table = 'payout_accounts' then
    v := v - array['account_number_ref','account_fingerprint'];
  end if;
  if p_table = 'webhook_deliveries' then
    v := v - array['payload','response_summary'];
  end if;
  if p_table = 'integration_secrets' then
    return jsonb_build_object('id', v->>'id', 'purpose', v->>'purpose', 'merchant_id', v->>'merchant_id');
  end if;

  return v;
end;
$$;

create or replace function public.jsonb_changed_keys(p_before jsonb, p_after jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
  from (
    select j.key as k
    from jsonb_object_keys(coalesce(p_before, '{}'::jsonb) || coalesce(p_after, '{}'::jsonb)) as j(key)
    where coalesce(p_before, '{}'::jsonb)->j.key is distinct from coalesce(p_after, '{}'::jsonb)->j.key
  ) s
$$;

create or replace function public.audit_table_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
  v_actor uuid;
  v_email text;
  v_merchant uuid;
  v_store uuid;
  v_resource_id text;
  v_actor_candidate text;
  v_source text;
begin
  if tg_op = 'INSERT' then
    v_before := null;
    v_after := to_jsonb(new);
    v_row := v_after;
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    v_row := v_after;
  else
    v_before := to_jsonb(old);
    v_after := null;
    v_row := v_before;
  end if;

  v_actor := auth.uid();
  if v_actor is null then
    v_actor_candidate := coalesce(
      v_row->>'updated_by', v_row->>'created_by', v_row->>'requested_by',
      v_row->>'verified_by', v_row->>'approved_by', v_row->>'user_id',
      v_row->>'owner_user_id'
    );
    v_actor := public.try_uuid(v_actor_candidate);
  end if;

  if v_actor is not null then
    select email into v_email from auth.users where id = v_actor;
  end if;

  v_merchant := public.try_uuid(v_row->>'merchant_id');
  v_store := public.try_uuid(v_row->>'store_id');
  v_resource_id := coalesce(v_row->>'id', v_row->>'order_no', v_row->>'payment_ref', v_row->>'withdrawal_ref');
  v_source := public.audit_source_for_table(tg_table_name);

  insert into public.activity_logs(
    event_name, event_category, severity, source_area, actor_type,
    actor_user_id, actor_email_snapshot, merchant_id, store_id,
    success, resource_type, resource_id, action, message,
    metadata, before_data, after_data
  ) values (
    'DATA.' || upper(tg_table_name) || '.' || tg_op,
    'DATA_CHANGE',
    'INFO',
    v_source,
    case when v_actor is null then 'SYSTEM' else 'USER' end,
    v_actor,
    v_email,
    v_merchant,
    v_store,
    true,
    tg_table_name,
    v_resource_id,
    tg_op,
    tg_op || ' ' || tg_table_name,
    jsonb_build_object(
      'schema', tg_table_schema,
      'table', tg_table_name,
      'operation', tg_op,
      'changed_fields', public.jsonb_changed_keys(v_before, v_after)
    ),
    case when v_before is null then null else public.sanitize_audit_row(tg_table_name, v_before) end,
    case when v_after is null then null else public.sanitize_audit_row(tg_table_name, v_after) end
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
exception when others then
  -- Business writes must not fail only because audit logging is unavailable.
  raise warning 'AnnyPay audit trigger failed on %.%: %', tg_table_schema, tg_table_name, sqlerrm;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Attach generic audit triggers to important operational tables that exist.
do $$
declare
  t text;
  tables text[] := array[
    'profiles','merchants','merchant_members','stores','products','product_images',
    'content_assets','salepages','customers','orders','order_items',
    'payment_accounts','payment_links','payment_transactions','payment_webhooks',
    'webhook_endpoints','webhook_deliveries','inbound_events','system_events',
    'refunds','settlements','ai_sessions','ai_actions','automation_rules','automation_runs',
    'store_subscriptions','subscription_invoices','ai_token_wallets','ai_token_ledger',
    'token_purchase_orders','payout_accounts','withdrawal_requests',
    'store_payout_policies','store_balances','store_balance_ledger'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
      execute format(
        'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_table_change()',
        'trg_audit_' || t, t
      );
    end if;
  end loop;
end $$;

comment on table public.activity_logs is
'Unified append-only log for login/session, frontend, backoffice, API, AI, database, payment, webhook, billing and payout activity.';
comment on table public.user_sessions is
'Authenticated user session registry used to answer who logged in, from which client, and when.';
