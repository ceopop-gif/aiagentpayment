-- AnnyPay Payment Fact / QR Snapshot
-- Run after database/billing.sql
-- Purpose: every QR/payment transaction is self-describing in ONE ROW.
-- Operational tables remain normalized, but payment_transactions carries an immutable purchase snapshot
-- so search, webhook processing, reconciliation and reporting do not need to join Order/Store/Product again.

alter table public.orders
  add column if not exists purchase_conditions jsonb not null default '{}'::jsonb;

alter table public.payment_transactions
  add column if not exists payment_ref text,
  add column if not exists store_id uuid references public.stores(id) on delete set null,
  add column if not exists store_name_snapshot text,
  add column if not exists order_no_snapshot text,
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists customer_name_snapshot text,
  add column if not exists customer_phone_snapshot text,
  add column if not exists sales_channel text not null default 'ONLINE',
  add column if not exists sale_page_id uuid references public.salepages(id) on delete set null,
  add column if not exists payment_link_id uuid references public.payment_links(id) on delete set null,
  add column if not exists item_count integer not null default 0,
  add column if not exists quantity_total integer not null default 0,
  add column if not exists product_summary text,
  add column if not exists items_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists subtotal_snapshot numeric(12,2) not null default 0,
  add column if not exists discount_snapshot numeric(12,2) not null default 0,
  add column if not exists shipping_snapshot numeric(12,2) not null default 0,
  add column if not exists purchase_conditions_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists shipping_address_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists requested_at timestamptz not null default now(),
  add column if not exists qr_payload text,
  add column if not exists qr_expires_at timestamptz,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;

create unique index if not exists uq_payment_transactions_payment_ref
  on public.payment_transactions(payment_ref)
  where payment_ref is not null;

create index if not exists idx_payment_fact_store_requested
  on public.payment_transactions(store_id, requested_at desc);

create index if not exists idx_payment_fact_order_no
  on public.payment_transactions(order_no_snapshot);

create index if not exists idx_payment_fact_phone
  on public.payment_transactions(customer_phone_snapshot)
  where customer_phone_snapshot is not null;

create index if not exists idx_payment_fact_status_requested
  on public.payment_transactions(status, requested_at desc);

-- Search helper: returns only the transaction row itself. No joins required.
create or replace function public.find_payment_fact(p_payment_ref text)
returns public.payment_transactions
language sql
stable
security definer
set search_path = public
as $$
  select t.*
  from public.payment_transactions t
  where t.payment_ref = p_payment_ref
    and public.is_merchant_member(t.merchant_id)
  limit 1
$$;

grant execute on function public.find_payment_fact(text) to authenticated;

comment on column public.payment_transactions.items_snapshot is
'Immutable commercial item snapshot at payment/QR creation time. Do not rewrite when product master changes.';
comment on column public.payment_transactions.purchase_conditions_snapshot is
'Immutable checkout/order conditions at payment/QR creation time.';
comment on column public.payment_transactions.payment_ref is
'AnnyPay public/internal payment reference embedded in provider metadata/QR reference when supported.';
