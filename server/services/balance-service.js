import { requireMerchantMember } from '../lib/supabase-admin.js';

export async function getStoreBalance({ admin, merchantId, userId, storeId, ledgerLimit = 50 }) {
  await requireMerchantMember(admin, merchantId, userId);
  const { error: releaseError } = await admin.rpc('release_matured_store_funds', { p_store_id: storeId });
  if (releaseError) throw releaseError;

  const [balance, policy, ledger] = await Promise.all([
    admin.from('store_balances').select('*').eq('merchant_id', merchantId).eq('store_id', storeId).maybeSingle(),
    admin.from('store_payout_policies').select('*').eq('merchant_id', merchantId).eq('store_id', storeId).maybeSingle(),
    admin.from('store_balance_ledger')
      .select('id,entry_type,amount,pending_delta,available_delta,reserved_delta,paid_out_delta,pending_after,available_after,reserved_after,paid_out_after,source_type,source_id,source_ref,available_at,created_at')
      .eq('merchant_id', merchantId).eq('store_id', storeId)
      .order('created_at', { ascending: false }).limit(Math.min(Number(ledgerLimit) || 50, 200))
  ]);
  for (const r of [balance, policy, ledger]) if (r.error) throw r.error;
  return { balance: balance.data, policy: policy.data, ledger: ledger.data || [] };
}

export async function creditPaidPaymentFunds({ admin, transactionId }) {
  const { data, error } = await admin.rpc('credit_paid_payment_to_store_balance', { p_transaction_id: transactionId });
  if (error) throw error;
  return data;
}

export async function reserveWithdrawalFunds({ admin, withdrawalId }) {
  const { data, error } = await admin.rpc('reserve_store_withdrawal', { p_withdrawal_id: withdrawalId });
  if (error) throw error;
  return data;
}

export async function completeWithdrawalFunds({ admin, withdrawalId, provider, providerPayoutId, completedAt = null }) {
  const { data, error } = await admin.rpc('complete_store_withdrawal', {
    p_withdrawal_id: withdrawalId,
    p_provider: provider,
    p_provider_payout_id: providerPayoutId,
    p_completed_at: completedAt || new Date().toISOString()
  });
  if (error) throw error;
  return data;
}

export async function releaseWithdrawalFunds({ admin, withdrawalId, reason, status = 'FAILED' }) {
  const { data, error } = await admin.rpc('release_store_withdrawal', {
    p_withdrawal_id: withdrawalId,
    p_reason: reason || 'Payout failed',
    p_status: status
  });
  if (error) throw error;
  return data;
}
