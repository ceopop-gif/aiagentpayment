import { requireMerchantMember } from '../lib/supabase-admin.js';
import { makeEvent, publishEvent } from '../events/event-bus.js';

export async function createPaymentIntent({ admin, merchantId, userId, orderId, provider, adapters, dispatchOutbound, runAutomations }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN', 'STAFF']);
  const adapter = adapters?.[provider];
  if (!adapter) throw new Error(`Payment provider ${provider} is not configured`);

  const { data: order, error: orderError } = await admin.from('orders')
    .select('id,order_no,total,currency,payment_status,order_status,store_id')
    .eq('id', orderId).eq('merchant_id', merchantId).single();
  if (orderError) throw orderError;
  if (['PAID','REFUNDED'].includes(order.payment_status)) throw new Error(`Order payment is already ${order.payment_status}`);

  const { data: account, error: accountError } = await admin.from('payment_accounts')
    .select('*').eq('merchant_id', merchantId).eq('provider', provider).eq('status', 'ACTIVE').maybeSingle();
  if (accountError) throw accountError;
  if (!account) throw new Error(`No ACTIVE ${provider} payment account for merchant`);

  const intent = await adapter.createPaymentIntent({
    merchantId,
    providerMerchantId: account.provider_merchant_id,
    orderId: order.id,
    orderNo: order.order_no,
    amount: Number(order.total),
    currency: order.currency,
    metadata: { merchant_id: merchantId, store_id: order.store_id }
  });

  if (!intent?.providerTransactionId) throw new Error('Provider did not return providerTransactionId');

  const { data: tx, error: txError } = await admin.from('payment_transactions').insert({
    order_id: order.id,
    merchant_id: merchantId,
    provider,
    provider_transaction_id: intent.providerTransactionId,
    amount: order.total,
    fee: 0,
    currency: order.currency,
    status: intent.status || 'PENDING',
    raw_provider_data: intent.raw || {}
  }).select('*').single();
  if (txError) throw txError;

  await admin.from('orders').update({ payment_status: 'PENDING', order_status: 'WAITING_PAYMENT', updated_at: new Date().toISOString() })
    .eq('id', order.id).eq('merchant_id', merchantId);

  const event = makeEvent({ merchantId, type: 'payment.created', resourceType: 'payment_transaction', resourceId: tx.id, data: {
    transaction_id: tx.id,
    order_id: order.id,
    provider,
    amount: Number(order.total),
    currency: order.currency,
    status: tx.status
  }});
  await publishEvent({ admin, event, dispatchOutbound, runAutomations });

  return {
    transaction: tx,
    checkout: intent.checkout || null,
    qr: intent.qr || null,
    expiresAt: intent.expiresAt || null
  };
}

export async function requestRefund({ admin, merchantId, userId, transactionId, amount, provider, adapters }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN']);
  throw new Error('REFUND_REQUIRES_EXPLICIT_CONFIRMATION');
}
