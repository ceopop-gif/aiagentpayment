import { requireMerchantMember } from '../lib/supabase-admin.js';

export async function resolveBillingStore({ admin, merchantId, userId, requestedStoreId = null }) {
  await requireMerchantMember(admin, merchantId, userId);

  let query = admin
    .from('store_subscriptions')
    .select('id,merchant_id,store_id,plan_id,status,current_period_start,current_period_end,grace_until,subscription_plans(code,name,monthly_fee,currency,monthly_ai_tokens)')
    .eq('merchant_id', merchantId)
    .in('status', ['ACTIVE', 'TRIAL']);

  if (requestedStoreId) query = query.eq('store_id', requestedStoreId);
  else query = query.order('activated_at', { ascending: true }).limit(1);

  const { data, error } = requestedStoreId ? await query.maybeSingle() : await query.maybeSingle();
  if (error) throw error;
  if (!data) {
    const err = new Error('SUBSCRIPTION_REQUIRED');
    err.code = 'SUBSCRIPTION_REQUIRED';
    throw err;
  }
  if (data.current_period_end && new Date(data.current_period_end).getTime() <= Date.now()) {
    const err = new Error('SUBSCRIPTION_EXPIRED');
    err.code = 'SUBSCRIPTION_EXPIRED';
    throw err;
  }
  return data;
}

export async function getStoreBilling({ admin, merchantId, userId, storeId }) {
  await requireMerchantMember(admin, merchantId, userId);
  const [subscription, wallet, plans, packs, invoices, purchases] = await Promise.all([
    admin.from('store_subscriptions')
      .select('*,subscription_plans(*)')
      .eq('merchant_id', merchantId).eq('store_id', storeId).maybeSingle(),
    admin.from('ai_token_wallets')
      .select('*').eq('merchant_id', merchantId).eq('store_id', storeId).maybeSingle(),
    admin.from('subscription_plans')
      .select('id,code,name,description,monthly_fee,currency,monthly_ai_tokens,features')
      .eq('status', 'ACTIVE').order('sort_order'),
    admin.from('token_packs')
      .select('id,code,name,token_amount,price,currency')
      .eq('status', 'ACTIVE').order('sort_order'),
    admin.from('subscription_invoices')
      .select('id,period_start,period_end,amount,currency,status,due_at,paid_at,created_at')
      .eq('merchant_id', merchantId).eq('store_id', storeId)
      .order('created_at', { ascending: false }).limit(24),
    admin.from('token_purchase_orders')
      .select('id,pack_id,token_amount,total_amount,currency,status,created_at,tokens_granted_at')
      .eq('merchant_id', merchantId).eq('store_id', storeId)
      .order('created_at', { ascending: false }).limit(24)
  ]);
  for (const r of [subscription, wallet, plans, packs, invoices, purchases]) if (r.error) throw r.error;

  const w = wallet.data || {};
  return {
    subscription: subscription.data,
    wallet: {
      monthly_granted: Number(w.monthly_granted || 0),
      monthly_used: Number(w.monthly_used || 0),
      monthly_remaining: Number(w.monthly_remaining || 0),
      topup_remaining: Number(w.topup_remaining || 0),
      total_remaining: Number(w.monthly_remaining || 0) + Number(w.topup_remaining || 0),
      period_start: w.period_start || null,
      period_end: w.period_end || null
    },
    plans: plans.data || [],
    tokenPacks: packs.data || [],
    invoices: invoices.data || [],
    tokenPurchases: purchases.data || []
  };
}

export async function requireAiEntitlement({ admin, merchantId, userId, storeId = null, minimumTokens = 1 }) {
  const subscription = await resolveBillingStore({ admin, merchantId, userId, requestedStoreId: storeId });
  const { data: wallet, error } = await admin.from('ai_token_wallets')
    .select('monthly_remaining,topup_remaining,period_start,period_end')
    .eq('store_id', subscription.store_id).maybeSingle();
  if (error) throw error;
  const total = Number(wallet?.monthly_remaining || 0) + Number(wallet?.topup_remaining || 0);
  if (total < minimumTokens) {
    const err = new Error('INSUFFICIENT_AI_TOKENS');
    err.code = 'INSUFFICIENT_AI_TOKENS';
    err.details = { storeId: subscription.store_id, totalRemaining: total };
    throw err;
  }
  return { subscription, wallet, storeId: subscription.store_id, totalRemaining: total };
}

export function extractAiUsage(response, { prompt = '', fallbackText = '' } = {}) {
  const usage = response?.usage || response?.meta?.usage || {};
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  const total = Number(usage.total_tokens ?? (input + output));
  if (total > 0) {
    return { inputTokens: Math.max(0, input), outputTokens: Math.max(0, output), totalTokens: total, estimated: false };
  }

  // Conservative fallback for gateways that do not expose usage yet.
  // Approximation is recorded so it can be distinguished in audit/billing reports.
  const estimatedInput = Math.max(1, Math.ceil(String(prompt || '').length / 4));
  const estimatedOutput = Math.max(1, Math.ceil(String(response?.text || fallbackText || '').length / 4));
  return {
    inputTokens: estimatedInput,
    outputTokens: estimatedOutput,
    totalTokens: estimatedInput + estimatedOutput,
    estimated: true
  };
}

export async function consumeAiUsage({
  admin, merchantId, userId, storeId, intent, provider, model,
  response, prompt = '', source = 'AI', refId = null, metadata = {}
}) {
  const usage = extractAiUsage(response, { prompt });
  const { data, error } = await admin.rpc('consume_store_ai_tokens', {
    p_store_id: storeId,
    p_user_id: userId,
    p_total_tokens: usage.totalTokens,
    p_input_tokens: usage.inputTokens,
    p_output_tokens: usage.outputTokens,
    p_intent: intent || null,
    p_provider: provider || null,
    p_model: model || response?.model || null,
    p_source: source,
    p_ref_id: refId || null,
    p_metadata: { ...metadata, usage_estimated: usage.estimated }
  });
  if (error) {
    const err = new Error(error.message || 'AI token consumption failed');
    if (/INSUFFICIENT_AI_TOKENS/.test(error.message || '')) err.code = 'INSUFFICIENT_AI_TOKENS';
    throw err;
  }
  return { usage, balance: data };
}

export async function createTokenPurchaseOrder({ admin, merchantId, userId, storeId, packId, quantity = 1, billingProvider = null }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN']);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('Invalid quantity');

  const [{ data: store, error: se }, { data: pack, error: pe }] = await Promise.all([
    admin.from('stores').select('id,merchant_id').eq('id', storeId).eq('merchant_id', merchantId).single(),
    admin.from('token_packs').select('id,token_amount,price,currency,status').eq('id', packId).eq('status', 'ACTIVE').single()
  ]);
  if (se) throw se; if (pe) throw pe;
  const tokenAmount = Number(pack.token_amount) * quantity;
  const totalAmount = Number(pack.price) * quantity;

  const { data, error } = await admin.from('token_purchase_orders').insert({
    merchant_id: merchantId,
    store_id: store.id,
    pack_id: pack.id,
    quantity,
    token_amount: tokenAmount,
    total_amount: totalAmount,
    currency: pack.currency,
    status: 'PENDING',
    billing_provider: billingProvider,
    created_by: userId
  }).select('*').single();
  if (error) throw error;
  return data;
}

export async function activateSubscriptionFromVerifiedPayment({
  admin, subscriptionId, invoiceId, providerPaymentId, paymentTransactionId = null,
  periodStart, periodEnd
}) {
  const { data: invoice, error: ie } = await admin.from('subscription_invoices')
    .update({
      status: 'PAID', provider_payment_id: providerPaymentId || null,
      payment_transaction_id: paymentTransactionId,
      paid_at: new Date().toISOString(), updated_at: new Date().toISOString()
    })
    .eq('id', invoiceId).eq('subscription_id', subscriptionId)
    .select('*').single();
  if (ie) throw ie;

  const { data: grant, error: ge } = await admin.rpc('grant_monthly_store_ai_tokens', {
    p_subscription_id: subscriptionId,
    p_period_start: periodStart || invoice.period_start,
    p_period_end: periodEnd || invoice.period_end,
    p_ref_id: invoice.id
  });
  if (ge) throw ge;
  return { invoice, grant };
}

export async function confirmTokenPurchaseFromVerifiedPayment({ admin, purchaseId, providerPaymentId, paymentTransactionId = null }) {
  const { data: purchase, error: pe } = await admin.from('token_purchase_orders')
    .update({
      status: 'PAID', provider_payment_id: providerPaymentId || null,
      payment_transaction_id: paymentTransactionId,
      updated_at: new Date().toISOString()
    })
    .eq('id', purchaseId).select('*').single();
  if (pe) throw pe;

  const { data: grant, error: ge } = await admin.rpc('grant_token_topup', { p_purchase_id: purchase.id });
  if (ge) throw ge;
  return { purchase, grant };
}
