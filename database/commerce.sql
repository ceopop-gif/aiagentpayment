-- AnnyPay Commerce V1: SalePage, public checkout and Payment Link
-- Run after schema.sql, policies.sql and onboarding.sql

alter table public.products
  add column if not exists track_stock boolean not null default true;

create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  slug text not null unique,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'THB',
  status text not null default 'ACTIVE' check (status in ('ACTIVE','DISABLED','EXPIRED')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_links enable row level security;

create policy "merchant access payment links" on public.payment_links
for all using (public.is_merchant_member(merchant_id))
with check (public.is_merchant_member(merchant_id));

create index if not exists idx_payment_links_merchant_created
  on public.payment_links(merchant_id, created_at desc);

-- Publishable SalePage data. Anonymous users receive only fields required to render the offer.
create or replace function public.get_published_offer(
  p_store_slug text,
  p_page_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'store', jsonb_build_object(
      'id', s.id,
      'name', s.store_name,
      'slug', s.store_slug,
      'logo_url', s.logo_url,
      'description', s.description,
      'currency', s.currency
    ),
    'page', jsonb_build_object(
      'id', sp.id,
      'slug', sp.slug,
      'headline', sp.headline,
      'content', sp.content
    ),
    'product', jsonb_build_object(
      'id', p.id,
      'name', p.product_name,
      'short_description', p.short_description,
      'description', p.description,
      'price', p.price,
      'sale_price', p.sale_price,
      'stock', p.stock,
      'track_stock', p.track_stock,
      'status', p.status
    )
  ) into v_result
  from public.salepages sp
  join public.stores s on s.id = sp.store_id
  join public.products p on p.id = sp.product_id
  where s.store_slug = p_store_slug
    and sp.slug = p_page_slug
    and s.status = 'PUBLISHED'
    and sp.status = 'PUBLISHED'
    and p.status = 'ACTIVE'
  limit 1;

  if v_result is null then
    raise exception 'Offer not found or not published';
  end if;

  return v_result;
end;
$$;

grant execute on function public.get_published_offer(text,text) to anon, authenticated;

-- Public checkout. The server computes price and total from authoritative product data.
-- It never creates a PAID payment state.
create or replace function public.create_public_order(
  p_store_slug text,
  p_page_slug text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text default null,
  p_quantity integer default 1,
  p_shipping_address jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_page public.salepages%rowtype;
  v_product public.products%rowtype;
  v_customer uuid;
  v_order uuid;
  v_order_no text;
  v_unit_price numeric(12,2);
  v_total numeric(12,2);
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then
    raise exception 'Invalid quantity';
  end if;
  if nullif(trim(p_customer_name), '') is null then
    raise exception 'Customer name is required';
  end if;
  if nullif(trim(p_customer_phone), '') is null then
    raise exception 'Customer phone is required';
  end if;

  select * into v_store
  from public.stores
  where store_slug = p_store_slug and status = 'PUBLISHED'
  limit 1;
  if v_store.id is null then raise exception 'Store not found'; end if;

  select * into v_page
  from public.salepages
  where store_id = v_store.id and slug = p_page_slug and status = 'PUBLISHED'
  limit 1;
  if v_page.id is null or v_page.product_id is null then raise exception 'SalePage not found'; end if;

  select * into v_product
  from public.products
  where id = v_page.product_id and store_id = v_store.id and status = 'ACTIVE'
  for update;
  if v_product.id is null then raise exception 'Product not available'; end if;

  if v_product.track_stock and v_product.stock < p_quantity then
    raise exception 'Insufficient stock';
  end if;

  v_unit_price := coalesce(v_product.sale_price, v_product.price);
  v_total := v_unit_price * p_quantity;
  v_order_no := 'AN' || to_char(clock_timestamp(),'YYYYMMDDHH24MISS') || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  insert into public.customers(merchant_id,name,phone,email)
  values (v_store.merchant_id,trim(p_customer_name),trim(p_customer_phone),nullif(trim(p_customer_email),''))
  returning id into v_customer;

  insert into public.orders(
    order_no, merchant_id, store_id, customer_id,
    subtotal, discount, shipping, total, currency,
    payment_status, order_status, shipping_address
  ) values (
    v_order_no, v_store.merchant_id, v_store.id, v_customer,
    v_total, 0, 0, v_total, v_store.currency,
    'PENDING', 'WAITING_PAYMENT', coalesce(p_shipping_address,'{}'::jsonb)
  ) returning id into v_order;

  insert into public.order_items(order_id,product_id,product_name,quantity,unit_price,line_total)
  values (v_order,v_product.id,v_product.product_name,p_quantity,v_unit_price,v_total);

  if v_product.track_stock then
    update public.products set stock = stock - p_quantity, updated_at = now() where id = v_product.id;
  end if;

  return jsonb_build_object(
    'order_id', v_order,
    'order_no', v_order_no,
    'amount', v_total,
    'currency', v_store.currency,
    'payment_status', 'PENDING',
    'order_status', 'WAITING_PAYMENT'
  );
end;
$$;

grant execute on function public.create_public_order(text,text,text,text,text,integer,jsonb) to anon, authenticated;

-- Payment Link public display. Payment remains pending until the real provider confirms it.
create or replace function public.get_payment_link(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.payment_links%rowtype;
begin
  select * into v_link from public.payment_links
  where slug = p_slug
    and status = 'ACTIVE'
    and (expires_at is null or expires_at > now())
  limit 1;
  if v_link.id is null then raise exception 'Payment link not found or expired'; end if;
  return jsonb_build_object(
    'id',v_link.id,'slug',v_link.slug,'description',v_link.description,
    'amount',v_link.amount,'currency',v_link.currency,'expires_at',v_link.expires_at
  );
end;
$$;

grant execute on function public.get_payment_link(text) to anon, authenticated;

create or replace function public.create_payment_link_order(
  p_slug text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.payment_links%rowtype;
  v_store uuid;
  v_customer uuid;
  v_order uuid;
  v_order_no text;
begin
  if nullif(trim(p_customer_name),'') is null or nullif(trim(p_customer_phone),'') is null then
    raise exception 'Customer name and phone are required';
  end if;
  select * into v_link from public.payment_links
  where slug=p_slug and status='ACTIVE' and (expires_at is null or expires_at > now())
  limit 1;
  if v_link.id is null then raise exception 'Payment link not found or expired'; end if;

  v_store := v_link.store_id;
  if v_store is null then
    select id into v_store from public.stores where merchant_id=v_link.merchant_id order by created_at limit 1;
  end if;
  if v_store is null then raise exception 'Merchant has no store for order recording'; end if;

  v_order_no := 'PAY' || to_char(clock_timestamp(),'YYYYMMDDHH24MISS') || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into public.customers(merchant_id,name,phone,email)
  values(v_link.merchant_id,trim(p_customer_name),trim(p_customer_phone),nullif(trim(p_customer_email),''))
  returning id into v_customer;

  insert into public.orders(order_no,merchant_id,store_id,customer_id,subtotal,total,currency,payment_status,order_status)
  values(v_order_no,v_link.merchant_id,v_store,v_customer,v_link.amount,v_link.amount,v_link.currency,'PENDING','WAITING_PAYMENT')
  returning id into v_order;

  insert into public.order_items(order_id,product_name,quantity,unit_price,line_total)
  values(v_order,v_link.description,1,v_link.amount,v_link.amount);

  return jsonb_build_object('order_id',v_order,'order_no',v_order_no,'amount',v_link.amount,'currency',v_link.currency,'payment_status','PENDING');
end;
$$;

grant execute on function public.create_payment_link_order(text,text,text,text) to anon, authenticated;
