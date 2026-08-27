import { requireMerchantMember } from '../lib/supabase-admin.js';

function addOneMonth(date = new Date()) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

export async function startStoreSubscription({ admin, merchantId, userId, storeId, planId, billingProvider = null }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN']);

  const [{ data: store, error: se }, { data: plan, error: pe }] = await Promise.all([
    admin.from('stores').select('id,merchant_id,store_name').eq('id', storeId).eq('merchant_id', merchantId).single(),
    admin.from('subscription_plans').select('id,code,name,monthly_fee,currency,monthly_ai_tokens,status').eq('id', planId).eq('status', 'ACTIVE').single()
  ]);
  if (se) throw se;
  if (pe) throw pe;

  const now = new Date();
  const periodStart = now.toISOString();
  const periodEnd = addOneMonth(now).toISOString();

  const { data: existing, error: ee } = await admin.from('store_subscriptions')
    .select('id,status').eq('store_id', store.id).maybeSingle();
  if (ee) throw ee;

  let subscription;
  if (existing) {
    const { data, error } = await admin.from('store_subscriptions').update({
      plan_id: plan.id,
      status: 'PENDING',
      billing_provider: billingProvider,
      updated_at: new Date().toISOString()
    }).eq('id', existing.id).eq('merchant_id', merchantId).select('*').single();
    if (error) throw error;
    subscription = data;
  } else {
    const { data, error } = await admin.from('store_subscriptions').insert({
      merchant_id: merchantId,
      store_id: store.id,
      plan_id: plan.id,
      status: 'PENDING',
      billing_provider: billingProvider
    }).select('*').single();
    if (error) throw error;
    subscription = data;
  }

  const { data: invoice, error: ie } = await admin.from('subscription_invoices').insert({
    merchant_id: merchantId,
    store_id: store.id,
    subscription_id: subscription.id,
    period_start: periodStart,
    period_end: periodEnd,
    amount: plan.monthly_fee,
    currency: plan.currency,
    status: 'PENDING',
    billing_provider: billingProvider,
    due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  }).select('*').single();
  if (ie) throw ie;

  return {
    subscription,
    invoice,
    plan,
    payment_required: Number(plan.monthly_fee) > 0,
    next_step: 'CREATE_VERIFIED_BILLING_PAYMENT',
    warning: 'Do not activate subscription or grant tokens until the billing payment is verified.'
  };
}
