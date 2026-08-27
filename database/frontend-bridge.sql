-- AnnyPay Frontend <-> Backoffice bridge
-- Run after billing.sql.
-- Public storefronts read only explicitly publishable commerce fields.

create or replace function public.get_public_store_catalog(p_store_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_products jsonb;
begin
  select * into v_store
  from public.stores
  where store_slug = p_store_slug
    and status = 'PUBLISHED'
  limit 1;

  if v_store.id is null then
    raise exception 'Store not found or not published';
  end if;

  select coalesce(jsonb_agg(item order by item->>'product_name'), '[]'::jsonb)
  into v_products
  from (
    select jsonb_build_object(
      'product_id', p.id,
      'product_name', p.product_name,
      'short_description', p.short_description,
      'price', p.price,
      'sale_price', p.sale_price,
      'stock', p.stock,
      'track_stock', p.track_stock,
      'salepage_slug', sp.slug,
      'headline', sp.headline
    ) as item
    from public.products p
    join lateral (
      select s1.slug, s1.headline
      from public.salepages s1
      where s1.store_id = v_store.id
        and s1.product_id = p.id
        and s1.status = 'PUBLISHED'
      order by s1.published_at desc nulls last, s1.created_at desc
      limit 1
    ) sp on true
    where p.store_id = v_store.id
      and p.status = 'ACTIVE'
      and (not p.track_stock or p.stock > 0)
  ) q;

  return jsonb_build_object(
    'store', jsonb_build_object(
      'id', v_store.id,
      'name', v_store.store_name,
      'slug', v_store.store_slug,
      'logo_url', v_store.logo_url,
      'description', v_store.description,
      'currency', v_store.currency,
      'theme', v_store.theme
    ),
    'products', v_products
  );
end;
$$;

grant execute on function public.get_public_store_catalog(text) to anon, authenticated;

-- Source-of-truth contract:
-- Backoffice writes stores/products/salepages.
-- Public storefront reads only PUBLISHED/ACTIVE data via this RPC.
-- Checkout writes orders through create_public_order().
-- Backoffice reads those same orders.
-- Payment Provider webhook updates transaction/order state and Backoffice sees it immediately.
