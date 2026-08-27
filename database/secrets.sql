-- AnnyPay encrypted server-side integration secrets
-- Run after database/backoffice.sql
-- No browser RLS policies are intentionally created.

create table if not exists public.integration_secrets (
  id text primary key,
  merchant_id uuid references public.merchants(id) on delete cascade,
  purpose text not null,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

alter table public.integration_secrets enable row level security;

-- Access only with trusted service-role backend.
create index if not exists idx_integration_secrets_merchant on public.integration_secrets(merchant_id);
