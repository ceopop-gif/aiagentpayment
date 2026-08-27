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

  const { data: tx, error: txError } = await admin.from('payment_transactions')
    .select('id,merchant_id,order_id,amount,currency,status')
    .eq('provider', provider)
    .eq('provider_transaction_id', normalized.providerTransactionId)
    .maybeSingle();
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

  const txPatch = { status: mapping.payment, raw_provider_data: normalized.raw || safePayload(rawBody) };
  if (mapping.payment === 'PAID') txPatch.paid_at = normalized.occurredAt || new Date().toISOString();

  const { error: updateTxError } = await admin.from('payment_transactions').update(txPatch).eq('id', tx.id);
  if (updateTxError) throw updateTxError;

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
      order_id: tx.order_id,
      provider,
      provider_transaction_id: normalized.providerTransactionId,
      amount: tx.amount,
      currency: tx.currency,
      status: mapping.payment
    }
  });

  await publishEvent({ admin, event, dispatchOutbound, runAutomations });
  return { status: 200, body: { ok: true } };
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
