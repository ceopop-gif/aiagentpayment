-- AnnyPay merchant onboarding RPC for Supabase
-- Run after schema.sql and policies.sql

create or replace function public.bootstrap_merchant(
  p_business_name text,
  p_display_name text default null,
  p_phone text default null,
  p_business_type text default 'ecommerce'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_merchant uuid;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  if nullif(trim(p_business_name), '') is null then
    raise exception 'Business name is required';
  end if;

  select email into v_email from auth.users where id = v_user;

  insert into public.profiles(user_id, display_name, phone)
  values (v_user, nullif(trim(p_display_name), ''), nullif(trim(p_phone), ''))
  on conflict (user_id) do update
  set display_name = coalesce(excluded.display_name, public.profiles.display_name),
      phone = coalesce(excluded.phone, public.profiles.phone),
      updated_at = now();

  insert into public.merchants(
    owner_user_id, business_name, business_type, phone, email,
    merchant_status, kyc_status, payment_status
  ) values (
    v_user, trim(p_business_name), coalesce(nullif(trim(p_business_type), ''), 'ecommerce'),
    nullif(trim(p_phone), ''), v_email,
    'PROFILE_CREATED', 'PENDING', 'NOT_CONNECTED'
  ) returning id into v_merchant;

  insert into public.merchant_members(merchant_id, user_id, role)
  values (v_merchant, v_user, 'OWNER')
  on conflict (merchant_id, user_id) do nothing;

  return v_merchant;
end;
$$;

grant execute on function public.bootstrap_merchant(text,text,text,text) to authenticated;
