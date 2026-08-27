-- AnnyPay Checkout hardening
-- Run after commerce.sql
-- Pending anonymous orders must not decrement stock. Stock mutation belongs in the verified payment flow.

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
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then raise exception 'Invalid quantity'; end if;
  if nullif(trim(p_customer_name),'') is null then raise exception 'Customer name is required'; end if;
  if nullif(trim(p_customer_phone),'') is null then raise exception 'Customer phone is required'; end if;

  select * into v_store from public.stores
  where store_slug=p_store_slug and status='PUBLISHED' limit 1;
  if v_store.id is null then raise exception 'Store not found'; end if;

  select * into v_page from public.salepages
  where store_id=v_store.id and slug=p_page_slug and status='PUBLISHED' limit 1;
  if v_page.id is null or v_page.product_id is null then raise exception 'SalePage not found'; end if;

  select * into v_product from public.products
  where id=v_page.product_id and store_id=v_store.id and status='ACTIVE';
  if v_product.id is null then raise exception 'Product not available'; end if;
  if v_product.track_stock and v_product.stock < p_quantity then raise exception 'Insufficient stock'; end if;

  v_unit_price:=coalesce(v_product.sale_price,v_product.price);
  v_total:=v_unit_price*p_quantity;
  v_order_no:='AN'||to_char(clock_timestamp(),'YYYYMMDDHH24MISS')||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  insert into public.customers(merchant_id,name,phone,email)
  values(v_store.merchant_id,trim(p_customer_name),trim(p_customer_phone),nullif(trim(p_customer_email),''))
  returning id into v_customer;

  insert into public.orders(order_no,merchant_id,store_id,customer_id,subtotal,discount,shipping,total,currency,payment_status,order_status,shipping_address)
  values(v_order_no,v_store.merchant_id,v_store.id,v_customer,v_total,0,0,v_total,v_store.currency,'PENDING','WAITING_PAYMENT',coalesce(p_shipping_address,'{}'::jsonb))
  returning id into v_order;

  insert into public.order_items(order_id,product_id,product_name,quantity,unit_price,line_total)
  values(v_order,v_product.id,v_product.product_name,p_quantity,v_unit_price,v_total);

  return jsonb_build_object('order_id',v_order,'order_no',v_order_no,'amount',v_total,'currency',v_store.currency,'payment_status','PENDING','order_status','WAITING_PAYMENT');
end;
$$;

grant execute on function public.create_public_order(text,text,text,text,text,integer,jsonb) to anon, authenticated;
