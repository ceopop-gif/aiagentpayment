-- AnyPay Platform Admin / Manual Merchant Provisioning
-- Public signup intentionally not enabled in this phase.

create extension if not exists pgcrypto;

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'ADMIN' check (role in ('OWNER','ADMIN','FINANCE','RISK','SUPPORT','VIEWER')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.merchant_provisioning (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null unique references public.merchants(id) on delete cascade,
  created_by_admin uuid null references auth.users(id) on delete set null,
  source text not null default 'ADMIN_MANUAL' check (source in ('ADMIN_MANUAL','PUBLIC_SIGNUP','PARTNER','IMPORT','API')),
  onboarding_status text not null default 'PROFILE_CREATED' check (onboarding_status in ('PROFILE_CREATED','OWNER_PENDING','KYC_PENDING','KYC_APPROVED','PAYMENT_PENDING','READY','SUSPENDED')),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.merchant_admin_notes (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  admin_user_id uuid null references auth.users(id) on delete set null,
  note text not null,
  visibility text not null default 'ADMIN_ONLY' check (visibility in ('ADMIN_ONLY','MERCHANT_VISIBLE')),
  created_at timestamptz not null default now()
);

create index if not exists idx_merchant_provisioning_status on public.merchant_provisioning(onboarding_status, updated_at desc);
create index if not exists idx_merchant_admin_notes_merchant on public.merchant_admin_notes(merchant_id, created_at desc);

alter table public.platform_admins enable row level security;
alter table public.merchant_provisioning enable row level security;
alter table public.merchant_admin_notes enable row level security;

create or replace function public.is_platform_admin(required_roles text[] default null)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.platform_admins pa
    where pa.user_id = auth.uid()
      and pa.status = 'ACTIVE'
      and (required_roles is null or pa.role = any(required_roles))
  );
$$;

drop policy if exists platform_admins_self_or_owner_select on public.platform_admins;
create policy platform_admins_self_or_owner_select on public.platform_admins for select using (
  user_id = auth.uid() or public.is_platform_admin(array['OWNER'])
);

drop policy if exists provisioning_admin_select on public.merchant_provisioning;
create policy provisioning_admin_select on public.merchant_provisioning for select using (public.is_platform_admin(null));

drop policy if exists notes_admin_select on public.merchant_admin_notes;
create policy notes_admin_select on public.merchant_admin_notes for select using (public.is_platform_admin(null));

-- Browser should not insert/update platform provisioning directly.
-- Trusted backend/service role performs manual merchant creation after checking platform_admins.

comment on table public.platform_admins is 'AnyPay platform-level admins, separate from merchant_members.';
comment on table public.merchant_provisioning is 'Tracks how a merchant entered AnyPay and its platform onboarding state.';
comment on table public.merchant_admin_notes is 'Platform-admin notes scoped to a merchant.';
