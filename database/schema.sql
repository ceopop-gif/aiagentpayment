-- AnnyPay Database V1 (PostgreSQL / Supabase)
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.merchants (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null,
  business_type text,
  phone text,
  email text,
  merchant_status text not null default 'NEW' check (merchant_status in ('NEW','PROFILE_CREATED','KYC_PENDING','KYC_APPROVED','PAYMENT_READY','ACTIVE','SUSPENDED','CLOSED')),
  kyc_status text not null default 'PENDING' check (kyc_status in ('PENDING','APPROVED','REJECTED','REVIEW')),
  payment_status text not null default 'NOT_CONNECTED' check (payment_status in ('NOT_CONNECTED','PENDING','ACTIVE','SUSPENDED','DISABLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.merchant_members (
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'OWNER' check (role in ('OWNER','ADMIN','STAFF','VIEWER')),
  created_at timestamptz not null default now(),
  primary key (merchant_id, user_id)
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_name text not null,
  store_slug text not null unique,
  logo_url text,
  theme jsonb not null default '{}'::jsonb,
  description text,
  currency text not null default 'THB',
  status text not null default 'DRAFT' check (status in ('DRAFT','READY','PUBLISHED','SUSPENDED','CLOSED')),
  domain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_name text not null,
  sku text,
  short_description text,
  description text,
  price numeric(12,2) not null check (price >= 0),
  sale_price numeric(12,2) check (sale_price is null or sale_price >= 0),
  stock integer not null default 0 check (stock >= 0),
  seo_title text,
  seo_description text,
  status text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','OUT_OF_STOCK','HIDDEN')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.salepages (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  slug text not null,
  headline text,
  content jsonb not null default '{}'::jsonb,
  status text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED','ARCHIVED')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, slug)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  name text,
  phone text,
  email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  shipping numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  currency text not null default 'THB',
  payment_status text not null default 'CREATED' check (payment_status in ('CREATED','PENDING','PROCESSING','PAID','FAILED','EXPIRED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')),
  order_status text not null default 'NEW' check (order_status in ('NEW','WAITING_PAYMENT','PAID','PROCESSING','SHIPPED','COMPLETED','CANCELLED','REFUNDED')),
  shipping_address jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  provider text not null,
  provider_merchant_id text,
  payment_methods jsonb not null default '[]'::jsonb,
  status text not null default 'NOT_CONNECTED' check (status in ('NOT_CONNECTED','PENDING','ACTIVE','SUSPENDED','DISABLED')),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  provider text not null,
  provider_transaction_id text,
  amount numeric(12,2) not null check (amount >= 0),
  fee numeric(12,2) not null default 0 check (fee >= 0),
  currency text not null default 'THB',
  status text not null default 'CREATED' check (status in ('CREATED','PENDING','PROCESSING','PAID','FAILED','EXPIRED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')),
  raw_provider_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique(provider, provider_transaction_id)
);

create table if not exists public.payment_webhooks (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text,
  event_type text,
  signature_valid boolean not null default false,
  payload jsonb not null,
  processed boolean not null default false,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique(provider, event_id)
);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  transaction_id uuid not null references public.payment_transactions(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','SUCCEEDED','FAILED','CANCELLED')),
  provider_refund_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  provider text not null,
  period_start timestamptz,
  period_end timestamptz,
  gross_amount numeric(12,2) not null default 0,
  fee_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','PAID','FAILED','HELD')),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_sessions (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_actions (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.ai_sessions(id) on delete set null,
  prompt text,
  intent text,
  tool text,
  target text,
  result jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING','SUCCESS','FAILED','REQUIRES_CONFIRMATION')),
  created_at timestamptz not null default now()
);

create index if not exists idx_stores_merchant on public.stores(merchant_id);
create index if not exists idx_products_merchant on public.products(merchant_id);
create index if not exists idx_orders_merchant_created on public.orders(merchant_id, created_at desc);
create index if not exists idx_transactions_merchant_created on public.payment_transactions(merchant_id, created_at desc);
create index if not exists idx_settlements_merchant_created on public.settlements(merchant_id, created_at desc);
create index if not exists idx_ai_actions_merchant_created on public.ai_actions(merchant_id, created_at desc);
