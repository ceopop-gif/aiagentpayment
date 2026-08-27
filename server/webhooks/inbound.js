import { makeEvent, publishEvent } from '../events/event-bus.js';

const PAYMENT_TO_ORDER = {
  'payment.pending': { payment: 'PENDING', order: 'WAITING_PAYMENT' },
  'payment.processing': { payment: 'PROCESSING', order: 'WAITING_PAYMENT' },
  'payment.paid': { payment: 'PAID', order: 'PAID' },
  'payment.failed': { payment: 'FAILED', order: 'WAITING_PAYMENT' },
  'payment.expired': { payment: 'EXPIRED', order: 'WAITING_PAYMENT' },
  'payment.cancelled': { payment: 'CANCELLED', order: 'CANCELLED' },
  'payment.refunded': { payment: 'REFUNDED', order: 'REFUNDED' }
};

export async function processInboundPaymentWebhook({
  admin,
  provider,
  rawBody,
  headers,
  adapters,
  dispatchOutbound,
  runAutomations
}) {
  const adapter = adapters?.[provider];
  if (!adapter) throw new Error(`Unknown payment provider: ${provider}`);

  let signatureValid = false;
  let normalized;

  try {
    signatureValid = await adapter.verifyWebhook(rawBody, headers);
    if (!signatureValid) {
      await admin.from('inbound_events').insert({
        source: 'PAYMENT_PROVIDER', provider, signature_valid: false,
        payload: safePayload(rawBody), status: 'REJECTED', error_message: 'Invalid signature'
      });
      return { status: 401, body: { ok: false, error: 'invalid_signature' } };
    }

    normalized = await adapter.normalizeWebhookEvent(rawBody, headers);
    if (!normalized?.externalEventId || !normalized?.type) {
      throw new Error('Provider adapter returned an invalid normalized event');
    }
  } catch (error) {
    if (!signatureValid) throw error;
    await admin.from('inbound_events').insert({
      source: 'PAYMENT_PROVIDER', provider, external_event_id: normalized?.externalEventId || null,
      event_type: normalized?.type || null, signature_valid: true,
      payload: safePayload(rawBody), normalized_event: normalized || null,
      status: 'FAILED', error_message: error.message
    });
    throw error;
  }

  const existing = await admin.from('inbound_events')
    .select('id,status')
    .eq('source', 'PAYMENT_PROVIDER')
    .eq('provider', provider)
    .eq('external_event_id', normalized.externalEventId)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data?.status === 'PROCESSED') {
    return { status: 200, body: { ok: true, duplicate: true } };
  }

  // Payment Fact row: no Order/Store/Product JOIN is required to understand the purchase.
  let txQuery = admin.from('payment_transactions').select(`
    id,payment_ref,merchant_id,store_id,store_name_snapshot,
    order_id,order_no_snapshot,customer_id,customer_name_snapshot,customer_phone_snapshot,
    provider,provider_transaction_id,amount,currency,status,requested_at,paid_at,
    sales_channel,sale_page_id,payment_link_id,item_count,quantity_total,product_summary,
    items_snapshot,subtotal_snapshot,discount_snapshot,shipping_snapshot,
    purchase_conditions_snapshot,shipping_address_snapshot,qr_expires_at,provider_metadata
  `).eq('provider', provider);

  if (normalized.providerTransactionId) {
    txQuery = txQuery.eq('provider_transaction_id', normalized.providerTransactionId);
  } else if (normalized.paymentRef) {
    txQuery = txQuery.eq('payment_ref', normalized.paymentRef);
  } else {
    await upsertInbound(admin, {
      merchantId: null, provider, normalized, rawBody,
      status: 'QUARANTINED', errorMessage: 'No provider transaction id or payment reference'
    });
    return { status: 202, body: { ok: true, quarantined: true } };
  }

  const { data: tx, error: txError } = await txQuery.maybeSingle();
  if (txError) throw txError;

  if (!tx) {
    await upsertInbound(admin, {
      merchantId: null, provider, normalized, rawBody,
      status: 'QUARANTINED', errorMessage: 'Transaction not found'
    });
    return { status: 202, body: { ok: true, quarantined: true } };
  }

  if (normalized.amount != null && Number(normalized.amount) !== Number(tx.amount)) {
    await upsertInbound(admin, {
      merchantId: tx.merchant_id, provider, normalized, rawBody,
      status: 'QUARANTINED', errorMessage: 'Amount mismatch'
    });
    return { status: 202, body: { ok: true, quarantined: true } };
  }

  if (normalized.currency && normalized.currency !== tx.currency) {
    await upsertInbound(admin, {
      merchantId: tx.merchant_id, provider, normalized, rawBody,
      status: 'QUARANTINED', errorMessage: 'Currency mismatch'
    });
    return { status: 202, body: { ok: true, quarantined: true } };
  }

  const mapping = PAYMENT_TO_ORDER[normalized.type];
  if (!mapping) {
    await upsertInbound(admin, {
      merchantId: tx.merchant_id, provider, normalized, rawBody,
      status: 'PROCESSED', errorMessage: null
    });
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const txPatch = {
    status: mapping.payment,
    raw_provider_data: normalized.raw || safePayload(rawBody)
  };
  if (mapping.payment === 'PAID') txPatch.paid_at = normalized.occurredAt || new Date().toISOString();

  const { error: updateTxError } = await admin.from('payment_transactions').update(txPatch).eq('id', tx.id);
  if (updateTxError) throw updateTxError;

  // Direct update by the order_id already stored in the same Payment Fact row. No lookup is needed.
  if (tx.order_id) {
    const { error: orderError } = await admin.from('orders').update({
      payment_status: mapping.payment,
      order_status: mapping.order,
      updated_at: new Date().toISOString()
    }).eq('id', tx.order_id).eq('merchant_id', tx.merchant_id);
    if (orderError) throw orderError;
  }

  await upsertInbound(admin, {
    merchantId: tx.merchant_id, provider, normalized, rawBody,
    status: 'PROCESSED', errorMessage: null
  });

  const event = makeEvent({
    merchantId: tx.merchant_id,
    type: normalized.type,
    resourceType: 'payment_transaction',
    resourceId: tx.id,
    data: {
      transaction_id: tx.id,
      payment_ref: tx.payment_ref,
      provider,
      provider_transaction_id: tx.provider_transaction_id,
      merchant_id: tx.merchant_id,
      store_id: tx.store_id,
      store_name: tx.store_name_snapshot,
      order_id: tx.order_id,
      order_no: tx.order_no_snapshot,
      products: tx.items_snapshot,
      product_summary: tx.product_summary,
      quantity_total: tx.quantity_total,
      amount: tx.amount,
      currency: tx.currency,
      subtotal: tx.subtotal_snapshot,
      discount: tx.discount_snapshot,
      shipping: tx.shipping_snapshot,
      purchase_conditions: tx.purchase_conditions_snapshot,
      requested_at: tx.requested_at,
      paid_at: txPatch.paid_at || tx.paid_at || null,
      status: mapping.payment
    }
  });

  await publishEvent({ admin, event, dispatchOutbound, runAutomations });
  return { status: 200, body: { ok: true, payment_ref: tx.payment_ref } };
}

async function upsertInbound(admin, { merchantId, provider, normalized, rawBody, status, errorMessage }) {
  const record = {
    merchant_id: merchantId,
    source: 'PAYMENT_PROVIDER',
    provider,
    external_event_id: normalized.externalEventId,
    event_type: normalized.type,
    signature_valid: true,
    payload: safePayload(rawBody),
    normalized_event: normalized,
    status,
    error_message: errorMessage,
    processed_at: status === 'PROCESSED' ? new Date().toISOString() : null
  };
  const { error } = await admin.from('inbound_events')
    .upsert(record, { onConflict: 'source,provider,external_event_id' });
  if (error) throw error;
}

function safePayload(rawBody) {
  try {
    return typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  } catch {
    return { raw: String(rawBody).slice(0, 20000) };
  }
}
