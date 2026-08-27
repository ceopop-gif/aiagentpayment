-- AnnyPay atomic balance functions
-- Run after store-balance-ledger.sql

create or replace function public.ensure_store_balance(p_store_id uuid)
returns public.store_balances
language plpgsql security definer set search_path=public
as $$
declare v_store public.stores%rowtype; v_balance public.store_balances%rowtype;
begin
  select * into v_store from public.stores where id=p_store_id;
  if v_store.id is null then raise exception 'STORE_NOT_FOUND'; end if;
  insert into public.store_balances(store_id,merchant_id,currency)
  values(v_store.id,v_store.merchant_id,v_store.currency) on conflict(store_id) do nothing;
  insert into public.store_payout_policies(store_id,merchant_id,currency)
  values(v_store.id,v_store.merchant_id,v_store.currency) on conflict(store_id) do nothing;
  select * into v_balance from public.store_balances where store_id=p_store_id;
  return v_balance;
end$$;

create or replace function public.credit_paid_payment_to_store_balance(p_transaction_id uuid)
returns public.store_balances
language plpgsql security definer set search_path=public
as $$
declare
  v_tx public.payment_transactions%rowtype; v_policy public.store_payout_policies%rowtype;
  v_balance public.store_balances%rowtype; v_net numeric(16,2); v_key text; v_available_at timestamptz;
begin
  select * into v_tx from public.payment_transactions where id=p_transaction_id for update;
  if v_tx.id is null then raise exception 'PAYMENT_TRANSACTION_NOT_FOUND'; end if;
  if v_tx.status<>'PAID' then raise exception 'PAYMENT_NOT_PAID'; end if;
  if v_tx.store_id is null then raise exception 'PAYMENT_STORE_ID_REQUIRED'; end if;
  perform public.ensure_store_balance(v_tx.store_id);
  select * into v_policy from public.store_payout_policies where store_id=v_tx.store_id;
  select * into v_balance from public.store_balances where store_id=v_tx.store_id for update;
  v_key:='payment-paid:'||v_tx.id::text;
  if exists(select 1 from public.store_balance_ledger where idempotency_key=v_key) then return v_balance; end if;
  v_net:=greatest(0,coalesce(v_tx.amount,0)-coalesce(v_tx.fee,0));
  v_available_at:=coalesce(v_tx.paid_at,now())+make_interval(mins=>coalesce(v_policy.hold_minutes,1440));
  update public.store_balances set pending_balance=pending_balance+v_net,total_paid_in=total_paid_in+v_tx.amount,total_fees=total_fees+coalesce(v_tx.fee,0),version=version+1,updated_at=now()
  where store_id=v_tx.store_id returning * into v_balance;
  insert into public.store_balance_ledger(merchant_id,store_id,currency,entry_type,amount,pending_delta,pending_after,available_after,reserved_after,paid_out_after,source_type,source_id,source_ref,idempotency_key,available_at,metadata)
  values(v_tx.merchant_id,v_tx.store_id,v_tx.currency,'PAYMENT_CREDIT_PENDING',v_net,v_net,v_balance.pending_balance,v_balance.available_balance,v_balance.reserved_balance,v_balance.total_paid_out,'PAYMENT_TRANSACTION',v_tx.id,coalesce(v_tx.payment_ref,v_tx.provider_transaction_id),v_key,v_available_at,jsonb_build_object('gross',v_tx.amount,'fee',v_tx.fee,'provider',v_tx.provider));
  return v_balance;
end$$;

create or replace function public.release_matured_store_funds(p_store_id uuid)
returns public.store_balances
language plpgsql security definer set search_path=public
as $$
declare v_credit public.store_balance_ledger%rowtype; v_balance public.store_balances%rowtype; v_key text;
begin
  perform public.ensure_store_balance(p_store_id);
  for v_credit in
    select l.* from public.store_balance_ledger l
    where l.store_id=p_store_id and l.entry_type='PAYMENT_CREDIT_PENDING' and l.available_at<=now()
      and not exists(select 1 from public.store_balance_ledger r where r.idempotency_key='payment-release:'||l.id::text)
    order by l.available_at,l.created_at for update skip locked
  loop
    select * into v_balance from public.store_balances where store_id=p_store_id for update;
    if v_balance.pending_balance<v_credit.amount then raise exception 'STORE_PENDING_BALANCE_INCONSISTENT'; end if;
    update public.store_balances set pending_balance=pending_balance-v_credit.amount,available_balance=available_balance+v_credit.amount,version=version+1,updated_at=now()
    where store_id=p_store_id returning * into v_balance;
    v_key:='payment-release:'||v_credit.id::text;
    insert into public.store_balance_ledger(merchant_id,store_id,currency,entry_type,amount,pending_delta,available_delta,pending_after,available_after,reserved_after,paid_out_after,source_type,source_id,source_ref,idempotency_key,metadata)
    values(v_credit.merchant_id,v_credit.store_id,v_credit.currency,'PAYMENT_RELEASE',v_credit.amount,-v_credit.amount,v_credit.amount,v_balance.pending_balance,v_balance.available_balance,v_balance.reserved_balance,v_balance.total_paid_out,'PAYMENT_LEDGER',v_credit.id,v_credit.source_ref,v_key,jsonb_build_object('credit_ledger_id',v_credit.id));
  end loop;
  select * into v_balance from public.store_balances where store_id=p_store_id;
  return v_balance;
end$$;

create or replace function public.reserve_store_withdrawal(p_withdrawal_id uuid)
returns public.withdrawal_requests
language plpgsql security definer set search_path=public
as $$
declare
  v_w public.withdrawal_requests%rowtype; v_policy public.store_payout_policies%rowtype;
  v_balance public.store_balances%rowtype; v_today numeric(16,2); v_key text;
  v_risk text:='PASS'; v_flags jsonb:='[]'::jsonb;
begin
  select * into v_w from public.withdrawal_requests where id=p_withdrawal_id for update;
  if v_w.id is null then raise exception 'WITHDRAWAL_NOT_FOUND'; end if;
  if v_w.status not in ('REQUESTED','HELD','REVIEWING') then raise exception 'WITHDRAWAL_NOT_RESERVABLE'; end if;
  perform public.release_matured_store_funds(v_w.store_id);
  perform public.ensure_store_balance(v_w.store_id);
  select * into v_policy from public.store_payout_policies where store_id=v_w.store_id;
  select * into v_balance from public.store_balances where store_id=v_w.store_id for update;
  if v_policy.status<>'ACTIVE' then raise exception 'STORE_PAYOUTS_NOT_ACTIVE'; end if;
  if v_w.amount<v_policy.min_withdrawal then raise exception 'WITHDRAWAL_BELOW_MINIMUM'; end if;
  if v_policy.max_withdrawal_per_request is not null and v_w.amount>v_policy.max_withdrawal_per_request then raise exception 'WITHDRAWAL_ABOVE_MAXIMUM'; end if;
  select coalesce(sum(amount),0) into v_today from public.withdrawal_requests where store_id=v_w.store_id and requested_at>=date_trunc('day',now()) and status not in ('FAILED','REJECTED','CANCELLED');
  if v_policy.daily_withdrawal_limit is not null and v_today>v_policy.daily_withdrawal_limit then raise exception 'DAILY_WITHDRAWAL_LIMIT_EXCEEDED'; end if;
  if v_policy.manual_review_above is not null and v_w.amount>=v_policy.manual_review_above then v_risk:='REVIEW';v_flags:=jsonb_build_array('AMOUNT_REQUIRES_MANUAL_REVIEW'); end if;
  if v_balance.available_balance<v_w.amount then raise exception 'INSUFFICIENT_AVAILABLE_BALANCE'; end if;
  v_key:='withdrawal-reserve:'||v_w.id::text;
  if not exists(select 1 from public.store_balance_ledger where idempotency_key=v_key) then
    update public.store_balances set available_balance=available_balance-v_w.amount,reserved_balance=reserved_balance+v_w.amount,version=version+1,updated_at=now()
    where store_id=v_w.store_id returning * into v_balance;
    insert into public.store_balance_ledger(merchant_id,store_id,currency,entry_type,amount,available_delta,reserved_delta,pending_after,available_after,reserved_after,paid_out_after,source_type,source_id,source_ref,idempotency_key,metadata)
    values(v_w.merchant_id,v_w.store_id,v_w.currency,'WITHDRAWAL_RESERVE',v_w.amount,-v_w.amount,v_w.amount,v_balance.pending_balance,v_balance.available_balance,v_balance.reserved_balance,v_balance.total_paid_out,'WITHDRAWAL',v_w.id,v_w.withdrawal_ref,v_key,jsonb_build_object('fee',v_w.fee,'net_amount',v_w.net_amount));
  end if;
  update public.withdrawal_requests set status=case when v_risk='REVIEW' then 'REVIEWING' else 'HELD' end,risk_status=v_risk,risk_flags=v_flags,reserved_at=coalesce(reserved_at,now()),updated_at=now()
  where id=v_w.id returning * into v_w;
  return v_w;
end$$;

create or replace function public.complete_store_withdrawal(p_withdrawal_id uuid,p_provider text,p_provider_payout_id text,p_completed_at timestamptz default now())
returns public.withdrawal_requests
language plpgsql security definer set search_path=public
as $$
declare v_w public.withdrawal_requests%rowtype;v_b public.store_balances%rowtype;v_key text;
begin
  select * into v_w from public.withdrawal_requests where id=p_withdrawal_id for update;
  if v_w.id is null then raise exception 'WITHDRAWAL_NOT_FOUND'; end if;
  if v_w.status='PAID' then return v_w; end if;
  if v_w.status not in ('HELD','APPROVED','PROCESSING') then raise exception 'WITHDRAWAL_NOT_COMPLETABLE'; end if;
  select * into v_b from public.store_balances where store_id=v_w.store_id for update;
  if v_b.reserved_balance<v_w.amount then raise exception 'RESERVED_BALANCE_INCONSISTENT'; end if;
  v_key:='withdrawal-paid:'||v_w.id::text;
  if not exists(select 1 from public.store_balance_ledger where idempotency_key=v_key) then
    update public.store_balances set reserved_balance=reserved_balance-v_w.amount,total_paid_out=total_paid_out+v_w.amount,version=version+1,updated_at=now()
    where store_id=v_w.store_id returning * into v_b;
    insert into public.store_balance_ledger(merchant_id,store_id,currency,entry_type,amount,reserved_delta,paid_out_delta,pending_after,available_after,reserved_after,paid_out_after,source_type,source_id,source_ref,idempotency_key,metadata)
    values(v_w.merchant_id,v_w.store_id,v_w.currency,'WITHDRAWAL_PAID',v_w.amount,-v_w.amount,v_w.amount,v_b.pending_balance,v_b.available_balance,v_b.reserved_balance,v_b.total_paid_out,'WITHDRAWAL',v_w.id,v_w.withdrawal_ref,v_key,jsonb_build_object('provider',p_provider,'provider_payout_id',p_provider_payout_id));
  end if;
  update public.withdrawal_requests set status='PAID',provider=p_provider,provider_payout_id=p_provider_payout_id,provider_status='PAID',paid_at=coalesce(p_completed_at,now()),updated_at=now()
  where id=v_w.id returning * into v_w;
  return v_w;
end$$;

create or replace function public.release_store_withdrawal(p_withdrawal_id uuid,p_reason text,p_status text default 'FAILED')
returns public.withdrawal_requests
language plpgsql security definer set search_path=public
as $$
declare v_w public.withdrawal_requests%rowtype;v_b public.store_balances%rowtype;v_key text;
begin
  if p_status not in ('FAILED','REJECTED','CANCELLED') then raise exception 'INVALID_WITHDRAWAL_RELEASE_STATUS'; end if;
  select * into v_w from public.withdrawal_requests where id=p_withdrawal_id for update;
  if v_w.id is null then raise exception 'WITHDRAWAL_NOT_FOUND'; end if;
  if v_w.released_at is not null then return v_w; end if;
  if v_w.reserved_at is not null then
    select * into v_b from public.store_balances where store_id=v_w.store_id for update;
    if v_b.reserved_balance<v_w.amount then raise exception 'RESERVED_BALANCE_INCONSISTENT'; end if;
    v_key:='withdrawal-release:'||v_w.id::text;
    if not exists(select 1 from public.store_balance_ledger where idempotency_key=v_key) then
      update public.store_balances set reserved_balance=reserved_balance-v_w.amount,available_balance=available_balance+v_w.amount,version=version+1,updated_at=now()
      where store_id=v_w.store_id returning * into v_b;
      insert into public.store_balance_ledger(merchant_id,store_id,currency,entry_type,amount,available_delta,reserved_delta,pending_after,available_after,reserved_after,paid_out_after,source_type,source_id,source_ref,idempotency_key,metadata)
      values(v_w.merchant_id,v_w.store_id,v_w.currency,'WITHDRAWAL_RELEASE',v_w.amount,v_w.amount,-v_w.amount,v_b.pending_balance,v_b.available_balance,v_b.reserved_balance,v_b.total_paid_out,'WITHDRAWAL',v_w.id,v_w.withdrawal_ref,v_key,jsonb_build_object('reason',p_reason,'status',p_status));
    end if;
  end if;
  update public.withdrawal_requests set status=p_status,failure_reason=p_reason,released_at=now(),updated_at=now() where id=v_w.id returning * into v_w;
  return v_w;
end$$;
