-- AnnyPay Backoffice V1
-- Run after schema.sql, policies.sql, onboarding.sql and commerce.sql

create table if not exists public.content_assets (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  content_type text not null check (content_type in (
    'PRODUCT_DESCRIPTION','HEADLINE','SALEPAGE_COPY','FAQ','SEO_TITLE','SEO_DESCRIPTION',
    'SOCIAL_POST','AD_COPY','PROMOTION','EMAIL','LINE_MESSAGE'
  )),
  language text not null default 'th',
  tone text,
  prompt text,
  content text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','ARCHIVED')),
  ai_model text,
  skill_version text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  integration_type text not null,
  provider text not null,
  display_name text not null,
  status text not null default 'DISCONNECTED' check (status in ('DISCONNECTED','PENDING','ACTIVE','ERROR','DISABLED')),
  config_public jsonb not null default '{}'::jsonb,
  secret_ref text,
  last_error text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  name text not null,
  url text not null,
  subscribed_events text[] not null default '{}',
  status text not null default 'ACTIVE' check (status in ('ACTIVE','DISABLED')),
  signing_secret_ref text,
  secret_hint text,
  failure_count integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_id text not null,
  event_type text not null,
  resource_id text,
  payload jsonb not null,
  attempt integer not null default 1,
  status text not null default 'PENDING' check (status in ('PENDING','DELIVERING','SUCCESS','FAILED','DEAD_LETTER')),
  response_status integer,
  response_summary text,
  next_retry_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique(endpoint_id, event_id, attempt)
);

create table if not exists public.inbound_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references public.merchants(id) on delete set null,
  source text not null,
  provider text,
  external_event_id text,
  event_type text,
  signature_valid boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  normalized_event jsonb,
  status text not null default 'RECEIVED' check (status in ('RECEIVED','VERIFIED','PROCESSED','REJECTED','QUARANTINED','FAILED')),
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(source, provider, external_event_id)
);

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  name text not null,
  trigger_event text not null,
  conditions jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','PAUSED','DISABLED')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  rule_id uuid references public.automation_rules(id) on delete set null,
  event_id text not null,
  trigger_event text not null,
  status text not null default 'PENDING' check (status in ('PENDING','RUNNING','SUCCESS','FAILED','SKIPPED')),
  result jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique(rule_id, event_id)
);

create table if not exists public.system_events (
  id text primary key,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  event_type text not null,
  resource_type text,
  resource_id text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.content_assets enable row level security;
alter table public.integration_connections enable row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.inbound_events enable row level security;
alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;
alter table public.system_events enable row level security;

create policy "merchant access content assets" on public.content_assets
for all using (public.is_merchant_member(merchant_id))
with check (public.is_merchant_member(merchant_id));

-- Connections may expose public configuration only; credentials referenced by secret_ref are server-managed.
create policy "merchant read integration connections" on public.integration_connections
for select using (public.is_merchant_member(merchant_id));

create policy "merchant read webhook endpoints" on public.webhook_endpoints
for select using (public.is_merchant_member(merchant_id));

create policy "merchant read webhook deliveries" on public.webhook_deliveries
for select using (public.is_merchant_member(merchant_id));

create policy "merchant read inbound events" on public.inbound_events
for select using (merchant_id is not null and public.is_merchant_member(merchant_id));

create policy "merchant access automation rules" on public.automation_rules
for all using (public.is_merchant_member(merchant_id))
with check (public.is_merchant_member(merchant_id));

create policy "merchant read automation runs" on public.automation_runs
for select using (public.is_merchant_member(merchant_id));

create policy "merchant read system events" on public.system_events
for select using (public.is_merchant_member(merchant_id));

create index if not exists idx_content_assets_merchant_created on public.content_assets(merchant_id, created_at desc);
create index if not exists idx_webhook_endpoints_merchant on public.webhook_endpoints(merchant_id);
create index if not exists idx_webhook_deliveries_endpoint_created on public.webhook_deliveries(endpoint_id, created_at desc);
create index if not exists idx_inbound_events_provider_created on public.inbound_events(provider, created_at desc);
create index if not exists idx_automation_rules_merchant on public.automation_rules(merchant_id);
create index if not exists idx_system_events_merchant_created on public.system_events(merchant_id, occurred_at desc);

-- IMPORTANT:
-- Browser clients should NOT write integration_connections, webhook_endpoints,
-- webhook_deliveries or inbound_events directly in production.
-- Use trusted backend APIs so secrets, URL validation, SSRF protection,
-- signing and delivery policies stay server-side.
