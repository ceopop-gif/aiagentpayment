import { randomUUID } from 'node:crypto';
import { requireMerchantMember } from '../lib/supabase-admin.js';
import { makeEvent, publishEvent } from '../events/event-bus.js';

export async function createPaymentIntent({
  admin,
  merchantId,
  userId,
  orderId,
  provider,
  adapters,
  dispatchOutbound,
  runAutomations,
  salesChannel = 'ONLINE',
  salePageId = null,
  paymentLinkId = null
}) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN', 'STAFF']);
  const adapter = adapters?.[provider];
  if (!adapter) throw new Error(`Payment provider ${provider} is not configured`);

  // Read the commercial context ONCE. From this point onward the payment row is self-describing.
  const { data: order, error: orderError } = await admin.from('orders')
    .select(`
      id,order_no,total,currency,payment_status,order_status,store_id,customer_id,
      subtotal,discount,shipping,shipping_address,purchase_conditions,created_at,
      stores(id,store_name),
      customers(id,name,phone),
      order_items(id,product_id,product_name,quantity,unit_price,line_total)
    `)
    .eq('id', orderId).eq('merchant_id', merchantId).single();
  if (orderError) throw orderError;
  if (['PAID','REFUNDED'].includes(order.payment_status)) throw new Error(`Order payment is already ${order.payment_status}`);

  const { data: account, error: accountError } = await admin.from('payment_accounts')
    .select('*').eq('merchant_id', merchantId).eq('provider', provider).eq('status', 'ACTIVE').maybeSingle();
  if (accountError) throw accountError;
  if (!account) throw new Error(`No ACTIVE ${provider} payment account for merchant`);

  const paymentRef = createPaymentRef();
  const items = (order.order_items || []).map(item => ({
    product_id: item.product_id,
    product_name: item.product_name,
    quantity: Number(item.quantity || 0),
    unit_price: Number(item.unit_price || 0),
    line_total: Number(item.line_total || 0)
  }));
  const quantityTotal = items.reduce((sum, item) => sum + item.quantity, 0);
  const productSummary = items.map(item => `${item.product_name} x${item.quantity}`).join(', ').slice(0, 1000);

  const providerMetadata = {
    annypay_payment_ref: paymentRef,
    merchant_id: merchantId,
    store_id: order.store_id,
    order_id: order.id,
    order_no: order.order_no,
    sales_channel: salesChannel,
    sale_page_id: salePageId,
    payment_link_id: paymentLinkId
  };

  const intent = await adapter.createPaymentIntent({
    merchantId,
    providerMerchantId: account.provider_merchant_id,
    paymentRef,
    orderId: order.id,
    orderNo: order.order_no,
    amount: Number(order.total),
    currency: order.currency,
    metadata: providerMetadata
  });

  if (!intent?.providerTransactionId) throw new Error('Provider did not return providerTransactionId');

  const qrPayload = typeof intent.qr === 'string'
    ? intent.qr
    : (intent.qr?.payload || intent.qr?.raw || null);

  const { data: tx, error: txError } = await admin.from('payment_transactions').insert({
    order_id: order.id,
    merchant_id: merchantId,
    store_id: order.store_id,
    customer_id: order.customer_id,
    provider,
    provider_transaction_id: intent.providerTransactionId,
    payment_ref: paymentRef,
    amount: order.total,
    fee: 0,
    currency: order.currency,
    status: intent.status || 'PENDING',

    // ONE-ROW PAYMENT FACT SNAPSHOT
    store_name_snapshot: order.stores?.store_name || null,
    order_no_snapshot: order.order_no,
    customer_name_snapshot: order.customers?.name || null,
    customer_phone_snapshot: order.customers?.phone || null,
    sales_channel: salesChannel,
    sale_page_id: salePageId,
    payment_link_id: paymentLinkId,
    item_count: items.length,
    quantity_total: quantityTotal,
    product_summary: productSummary || null,
    items_snapshot: items,
    subtotal_snapshot: Number(order.subtotal || 0),
    discount_snapshot: Number(order.discount || 0),
    shipping_snapshot: Number(order.shipping || 0),
    purchase_conditions_snapshot: order.purchase_conditions || {},
    shipping_address_snapshot: order.shipping_address || {},
    requested_at: new Date().toISOString(),
    qr_payload: qrPayload,
    qr_expires_at: intent.expiresAt || null,
    provider_metadata: providerMetadata,
    raw_provider_data: intent.raw || {}
  }).select('*').single();
  if (txError) throw txError;

  await admin.from('orders').update({
    payment_status: 'PENDING',
    order_status: 'WAITING_PAYMENT',
    updated_at: new Date().toISOString()
  }).eq('id', order.id).eq('merchant_id', merchantId);

  const event = makeEvent({
    merchantId,
    type: 'payment.created',
    resourceType: 'payment_transaction',
    resourceId: tx.id,
    data: {
      transaction_id: tx.id,
      payment_ref: paymentRef,
      order_id: order.id,
      order_no: order.order_no,
      store_id: order.store_id,
      store_name: order.stores?.store_name || null,
      products: items,
      provider,
      amount: Number(order.total),
      currency: order.currency,
      status: tx.status,
      requested_at: tx.requested_at,
      purchase_conditions: order.purchase_conditions || {}
    }
  });
  await publishEvent({ admin, event, dispatchOutbound, runAutomations });

  return {
    paymentRef,
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

function createPaymentRef() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `AP${y}${m}${d}-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}
