import crypto from 'node:crypto';
import { requireMerchantMember } from '../lib/supabase-admin.js';
import { reserveWithdrawalFunds, completeWithdrawalFunds, releaseWithdrawalFunds } from './balance-service.js';

function normalizeAccountNumber(value) {
  return String(value || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

function accountFingerprint({ bankCode, accountNumber }) {
  return crypto.createHash('sha256')
    .update(`${String(bankCode || '').toUpperCase()}:${normalizeAccountNumber(accountNumber)}`)
    .digest('hex');
}

function last4(value) {
  return normalizeAccountNumber(value).slice(-4);
}

export async function listPayoutAccounts({ admin, merchantId, userId, storeId }) {
  await requireMerchantMember(admin, merchantId, userId);
  const { data, error } = await admin.from('payout_accounts')
    .select('id,store_id,bank_code,bank_name,account_name,account_number_last4,account_type,status,verification_method,verified_at,available_for_withdrawal_at,is_default,created_at')
    .eq('merchant_id', merchantId).eq('store_id', storeId).neq('status', 'REMOVED')
    .order('is_default', { ascending: false }).order('created_at');
  if (error) throw error;
  return data || [];
}

export async function registerPayoutAccount({ admin, merchantId, userId, storeId, input, secretStore }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN']);
  if (!secretStore) throw new Error('Secret Store is required');

  const bankCode = String(input?.bankCode || '').trim().toUpperCase();
  const bankName = String(input?.bankName || '').trim();
  const accountName = String(input?.accountName || '').trim();
  const accountNumber = normalizeAccountNumber(input?.accountNumber);
  if (!bankCode || !bankName || !accountName || accountNumber.length < 4) {
    throw new Error('bankCode, bankName, accountName and valid accountNumber are required');
  }

  const { data: store, error: storeError } = await admin.from('stores')
    .select('id,merchant_id').eq('id', storeId).eq('merchant_id', merchantId).single();
  if (storeError) throw storeError;

  const { count, error: countError } = await admin.from('payout_accounts')
    .select('id', { count: 'exact', head: true }).eq('store_id', store.id).neq('status', 'REMOVED');
  if (countError) throw countError;
  if ((count || 0) >= 5) {
    const err = new Error('STORE_PAYOUT_ACCOUNT_LIMIT_REACHED');
    err.code = 'STORE_PAYOUT_ACCOUNT_LIMIT_REACHED';
    throw err;
  }

  const fingerprint = accountFingerprint({ bankCode, accountNumber });
  const secretId = `payout/${merchantId}/${storeId}/${crypto.randomUUID()}`;
  const accountNumberRef = await secretStore.put(secretId, accountNumber, { merchantId, purpose: 'payout-account-number' });

  try {
    const { data, error } = await admin.from('payout_accounts').insert({
      merchant_id: merchantId, store_id: storeId, bank_code: bankCode, bank_name: bankName,
      account_name: accountName, account_number_ref: accountNumberRef,
      account_number_last4: last4(accountNumber), account_fingerprint: fingerprint,
      account_type: input.accountType || null, status: 'PENDING_VERIFICATION',
      is_default: false, created_by: userId
    }).select('id,store_id,bank_code,bank_name,account_name,account_number_last4,status,is_default,created_at').single();
    if (error) throw error;
    return data;
  } catch (error) {
    await secretStore.delete(accountNumberRef).catch(() => {});
    throw error;
  }
}

export async function verifyPayoutAccount({
  admin, merchantId, userId, storeId, payoutAccountId, provider, payoutProviders, secretStore
}) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN']);
  const adapter = payoutProviders?.[String(provider || '').toLowerCase()];
  if (!adapter) throw new Error(`Payout provider ${provider} is not configured`);
  if (!secretStore) throw new Error('Secret Store is required');

  const { data: account, error } = await admin.from('payout_accounts').select('*')
    .eq('id', payoutAccountId).eq('merchant_id', merchantId).eq('store_id', storeId).single();
  if (error) throw error;
  if (!['PENDING_VERIFICATION','VERIFIED'].includes(account.status)) {
    throw new Error(`PAYOUT_ACCOUNT_STATUS_${account.status}`);
  }

  const accountNumber = await secretStore.get(account.account_number_ref);
  if (!accountNumber) throw new Error('PAYOUT_ACCOUNT_SECRET_NOT_FOUND');
  const result = await adapter.verifyAccount({
    bankCode: account.bank_code,
    bankName: account.bank_name,
    accountName: account.account_name,
    accountNumber,
    accountType: account.account_type,
    reference: account.id
  });

  if (result?.verified !== true) {
    const finalReject = result?.final === true;
    const status = finalReject ? 'REJECTED' : 'PENDING_VERIFICATION';
    const { data, error: updateError } = await admin.from('payout_accounts').update({
      status, verification_method: `PROVIDER:${provider}`, updated_at: new Date().toISOString()
    }).eq('id', account.id).select('id,status,bank_name,account_name,account_number_last4').single();
    if (updateError) throw updateError;
    return { account: data, providerResult: result };
  }

  const now = new Date().toISOString();
  const { data, error: updateError } = await admin.from('payout_accounts').update({
    status: 'ACTIVE', verification_method: `PROVIDER:${provider}`,
    verified_at: now, verified_by: userId,
    available_for_withdrawal_at: result.availableAt || now,
    updated_at: now
  }).eq('id', account.id).select('id,status,bank_name,account_name,account_number_last4,verified_at,available_for_withdrawal_at').single();
  if (updateError) throw updateError;
  return { account: data, providerResult: result };
}

export async function setDefaultPayoutAccount({ admin, merchantId, userId, storeId, payoutAccountId }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN']);
  const { data: account, error } = await admin.from('payout_accounts')
    .select('id,status,verified_at').eq('id', payoutAccountId)
    .eq('merchant_id', merchantId).eq('store_id', storeId).single();
  if (error) throw error;
  if (account.status !== 'ACTIVE' || !account.verified_at) throw new Error('PAYOUT_ACCOUNT_NOT_VERIFIED_ACTIVE');

  await admin.from('payout_accounts').update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('merchant_id', merchantId).eq('store_id', storeId).eq('is_default', true);
  const { data, error: updateError } = await admin.from('payout_accounts')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', payoutAccountId).eq('merchant_id', merchantId).eq('store_id', storeId)
    .select('id,bank_name,account_name,account_number_last4,status,is_default').single();
  if (updateError) throw updateError;
  return data;
}

export async function requestWithdrawal({
  admin, merchantId, userId, storeId, payoutAccountId, amount, fee = 0, currency = 'THB', metadata = {}
}) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN']);
  const requestedAmount = Number(amount);
  const withdrawalFee = Number(fee || 0);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) throw new Error('Invalid withdrawal amount');
  if (!Number.isFinite(withdrawalFee) || withdrawalFee < 0 || withdrawalFee > requestedAmount) throw new Error('Invalid withdrawal fee');

  const withdrawalRef = `WD${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0,14)}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const { data, error } = await admin.from('withdrawal_requests').insert({
    withdrawal_ref: withdrawalRef, merchant_id: merchantId, store_id: storeId,
    payout_account_id: payoutAccountId, amount: requestedAmount, fee: withdrawalFee,
    net_amount: requestedAmount - withdrawalFee, currency, status: 'REQUESTED',
    requested_by: userId, metadata
  }).select('*').single();
  if (error) throw error;

  try {
    return await reserveWithdrawalFunds({ admin, withdrawalId: data.id });
  } catch (reserveError) {
    await admin.from('withdrawal_requests').update({
      status: 'REJECTED', failure_reason: reserveError.message, risk_status: 'BLOCKED',
      risk_flags: [reserveError.code || reserveError.message], updated_at: new Date().toISOString()
    }).eq('id', data.id).catch(() => {});
    throw reserveError;
  }
}

export async function submitWithdrawalToProvider({
  admin, merchantId, userId, withdrawalId, provider, payoutProviders, secretStore
}) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN']);
  const adapter = payoutProviders?.[String(provider || '').toLowerCase()];
  if (!adapter) throw new Error(`Payout provider ${provider} is not configured`);
  if (!secretStore) throw new Error('Secret Store is required');

  const { data: withdrawal, error } = await admin.from('withdrawal_requests').select('*')
    .eq('id', withdrawalId).eq('merchant_id', merchantId).single();
  if (error) throw error;
  if (withdrawal.risk_status !== 'PASS') throw new Error('WITHDRAWAL_REQUIRES_RISK_APPROVAL');
  if (!['HELD','APPROVED'].includes(withdrawal.status)) throw new Error(`WITHDRAWAL_STATUS_${withdrawal.status}`);

  const { data: account, error: ae } = await admin.from('payout_accounts').select('*')
    .eq('id', withdrawal.payout_account_id).eq('store_id', withdrawal.store_id)
    .eq('merchant_id', merchantId).single();
  if (ae) throw ae;
  if (account.status !== 'ACTIVE' || !account.verified_at) throw new Error('PAYOUT_ACCOUNT_NOT_VERIFIED_ACTIVE');

  const accountNumber = await secretStore.get(account.account_number_ref);
  if (!accountNumber) throw new Error('PAYOUT_ACCOUNT_SECRET_NOT_FOUND');

  const providerResult = await adapter.createPayout({
    withdrawalRef: withdrawal.withdrawal_ref,
    amount: Number(withdrawal.net_amount),
    grossAmount: Number(withdrawal.amount),
    fee: Number(withdrawal.fee),
    currency: withdrawal.currency,
    bankCode: account.bank_code,
    bankName: account.bank_name,
    accountName: account.account_name,
    accountNumber,
    metadata: { merchant_id: merchantId, store_id: withdrawal.store_id, withdrawal_id: withdrawal.id }
  });
  if (!providerResult?.providerPayoutId) throw new Error('Provider did not return providerPayoutId');

  const now = new Date().toISOString();
  const { data: updated, error: ue } = await admin.from('withdrawal_requests').update({
    status: 'PROCESSING', provider, provider_payout_id: providerResult.providerPayoutId,
    provider_status: providerResult.status || 'PROCESSING', submitted_at: now, updated_at: now
  }).eq('id', withdrawal.id).select('*').single();
  if (ue) throw ue;

  if (providerResult.final === true && providerResult.status === 'PAID') {
    return completeWithdrawalFunds({
      admin, withdrawalId: withdrawal.id, provider,
      providerPayoutId: providerResult.providerPayoutId,
      completedAt: providerResult.completedAt || now
    });
  }
  if (providerResult.final === true && ['FAILED','REJECTED'].includes(providerResult.status)) {
    return releaseWithdrawalFunds({
      admin, withdrawalId: withdrawal.id,
      reason: providerResult.reason || `Provider ${providerResult.status}`,
      status: providerResult.status
    });
  }
  return updated;
}

export async function listWithdrawals({ admin, merchantId, userId, storeId, limit = 50 }) {
  await requireMerchantMember(admin, merchantId, userId);
  const { data, error } = await admin.from('withdrawal_requests')
    .select('id,withdrawal_ref,store_id,payout_account_id,amount,fee,net_amount,currency,status,risk_status,risk_flags,bank_name_snapshot,account_name_snapshot,account_last4_snapshot,requested_at,reserved_at,submitted_at,provider,provider_payout_id,provider_status,paid_at,failure_reason')
    .eq('merchant_id', merchantId).eq('store_id', storeId)
    .order('requested_at', { ascending: false }).limit(Math.min(Number(limit) || 50, 200));
  if (error) throw error;
  return data || [];
}
