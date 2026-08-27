-- AnnyPay Supabase Row Level Security
-- Run after database/schema.sql

create or replace function public.is_merchant_member(target_merchant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.merchant_members mm
    where mm.merchant_id = target_merchant
      and mm.user_id = auth.uid()
  );
$$;

grant execute on function public.is_merchant_member(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.merchants enable row level security;
alter table public.merchant_members enable row level security;
alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.salepages enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_accounts enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.refunds enable row level security;
alter table public.settlements enable row level security;
alter table public.ai_sessions enable row level security;
alter table public.ai_actions enable row level security;

-- Webhook records must only be accessed by trusted backend/service-role.
alter table public.payment_webhooks enable row level security;

create policy "profile read own" on public.profiles
for select using (user_id = auth.uid());
create policy "profile update own" on public.profiles
for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "profile insert own" on public.profiles
for insert with check (user_id = auth.uid());

create policy "merchant members can read merchant" on public.merchants
for select using (public.is_merchant_member(id) or owner_user_id = auth.uid());
create policy "owner can insert merchant" on public.merchants
for insert with check (owner_user_id = auth.uid());
create policy "merchant members can update merchant" on public.merchants
for update using (public.is_merchant_member(id) or owner_user_id = auth.uid())
with check (public.is_merchant_member(id) or owner_user_id = auth.uid());

create policy "members can read membership" on public.merchant_members
for select using (user_id = auth.uid() or public.is_merchant_member(merchant_id));
create policy "owner can add membership" on public.merchant_members
for insert with check (
  exists(select 1 from public.merchants m where m.id = merchant_id and m.owner_user_id = auth.uid())
);
create policy "owner can update membership" on public.merchant_members
for update using (
  exists(select 1 from public.merchants m where m.id = merchant_id and m.owner_user_id = auth.uid())
);
create policy "owner can delete membership" on public.merchant_members
for delete using (
  exists(select 1 from public.merchants m where m.id = merchant_id and m.owner_user_id = auth.uid())
);

create policy "merchant access stores" on public.stores
for all using (public.is_merchant_member(merchant_id))
with check (public.is_merchant_member(merchant_id));

create policy "merchant access products" on public.products
for all using (public.is_merchant_member(merchant_id))
with check (public.is_merchant_member(merchant_id));

create policy "merchant access product images" on public.product_images
for all using (
  exists(select 1 from public.products p where p.id = product_id and public.is_merchant_member(p.merchant_id))
)
with check (
  exists(select 1 from public.products p where p.id = product_id and public.is_merchant_member(p.merchant_id))
);

create policy "merchant access salepages" on public.salepages
for all using (public.is_merchant_member(merchant_id))
with check (public.is_merchant_member(merchant_id));

create policy "merchant access customers" on public.customers
for all using (public.is_merchant_member(merchant_id))
with check (public.is_merchant_member(merchant_id));

create policy "merchant access orders" on public.orders
for all using (public.is_merchant_member(merchant_id))
with check (public.is_merchant_member(merchant_id));

create policy "merchant access order items" on public.order_items
for all using (
  exists(select 1 from public.orders o where o.id = order_id and public.is_merchant_member(o.merchant_id))
)
with check (
  exists(select 1 from public.orders o where o.id = order_id and public.is_merchant_member(o.merchant_id))
);

create policy "merchant read payment accounts" on public.payment_accounts
for select using (public.is_merchant_member(merchant_id));

-- Transaction, refund and settlement writes should come from trusted backend/service-role.
create policy "merchant read transactions" on public.payment_transactions
for select using (public.is_merchant_member(merchant_id));
create policy "merchant read refunds" on public.refunds
for select using (public.is_merchant_member(merchant_id));
create policy "merchant read settlements" on public.settlements
for select using (public.is_merchant_member(merchant_id));

create policy "merchant access ai sessions" on public.ai_sessions
for all using (public.is_merchant_member(merchant_id) and user_id = auth.uid())
with check (public.is_merchant_member(merchant_id) and user_id = auth.uid());

create policy "merchant read ai actions" on public.ai_actions
for select using (public.is_merchant_member(merchant_id));

-- IMPORTANT:
-- Do not create browser-side INSERT/UPDATE policies for payment_transactions,
-- payment_webhooks, refunds, settlements or payment account credentials.
-- Those writes must be performed by a trusted server using the service role.
