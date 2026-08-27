import { completeWithdrawalFunds, releaseWithdrawalFunds } from '../services/balance-service.js';
import { makeEvent, publishEvent } from '../events/event-bus.js';

export async function processInboundPayoutWebhook({
  admin, provider, rawBody, headers, payoutProviders, dispatchOutbound, runAutomations
}) {
  const adapter = payoutProviders?.[String(provider || '').toLowerCase()];
  if (!adapter) throw new Error(`Unknown payout provider: ${provider}`);

  const valid = await adapter.verifyWebhook(rawBody, headers);
  if (!valid) {
    await admin.from('inbound_events').insert({
      source: 'PAYOUT_PROVIDER', provider, signature_valid: false,
      payload: safePayload(rawBody), status: 'REJECTED', error_message: 'Invalid signature'
    });
    return { status: 401, body: { ok: false, error: 'invalid_signature' } };
  }

  const evt = await adapter.normalizeWebhookEvent(rawBody, headers);
  if (!evt?.externalEventId || !evt?.type) throw new Error('Invalid payout event');

  const prior = await admin.from('inbound_events').select('id,status')
    .eq('source','PAYOUT_PROVIDER').eq('provider',provider)
    .eq('external_event_id',evt.externalEventId).maybeSingle();
  if (prior.error) throw prior.error;
  if (prior.data?.status === 'PROCESSED') return { status: 200, body: { ok: true, duplicate: true } };

  let q = admin.from('withdrawal_requests').select('*').eq('provider',provider);
  if (evt.providerPayoutId) q = q.eq('provider_payout_id',evt.providerPayoutId);
  else if (evt.withdrawalRef) q = q.eq('withdrawal_ref',evt.withdrawalRef);
  else throw new Error('Payout event has no providerPayoutId or withdrawalRef');
  const { data: withdrawal, error: we } = await q.maybeSingle();
  if (we) throw we;
  if (!withdrawal) {
    await upsertInbound(admin, provider, evt, rawBody, null, 'QUARANTINED', 'Withdrawal not found');
    return { status: 202, body: { ok: true, quarantined: true } };
  }

  let result = withdrawal;
  if (evt.type === 'payout.paid') {
    result = await completeWithdrawalFunds({
      admin, withdrawalId: withdrawal.id, provider,
      providerPayoutId: evt.providerPayoutId || withdrawal.provider_payout_id,
      completedAt: evt.occurredAt || new Date().toISOString()
    });
  } else if (evt.type === 'payout.failed' || evt.type === 'payout.rejected') {
    result = await releaseWithdrawalFunds({
      admin, withdrawalId: withdrawal.id,
      reason: evt.reason || evt.type,
      status: evt.type === 'payout.rejected' ? 'REJECTED' : 'FAILED'
    });
  } else if (evt.type === 'payout.processing') {
    const { data, error } = await admin.from('withdrawal_requests').update({
      status: 'PROCESSING', provider_status: evt.providerStatus || 'PROCESSING', updated_at: new Date().toISOString()
    }).eq('id', withdrawal.id).select('*').single();
    if (error) throw error;
    result = data;
  }

  await upsertInbound(admin, provider, evt, rawBody, withdrawal.merchant_id, 'PROCESSED', null);

  const event = makeEvent({
    merchantId: withdrawal.merchant_id,
    type: evt.type,
    resourceType: 'withdrawal_request',
    resourceId: withdrawal.id,
    data: {
      withdrawal_id: withdrawal.id,
      withdrawal_ref: withdrawal.withdrawal_ref,
      store_id: withdrawal.store_id,
      amount: Number(withdrawal.amount),
      net_amount: Number(withdrawal.net_amount),
      currency: withdrawal.currency,
      provider,
      provider_payout_id: evt.providerPayoutId || withdrawal.provider_payout_id,
      status: result.status
    }
  });
  await publishEvent({ admin, event, dispatchOutbound, runAutomations });
  return { status: 200, body: { ok: true } };
}

async function upsertInbound(admin, provider, evt, rawBody, merchantId, status, errorMessage) {
  const record = {
    merchant_id: merchantId, source: 'PAYOUT_PROVIDER', provider,
    external_event_id: evt.externalEventId, event_type: evt.type,
    signature_valid: true, payload: safePayload(rawBody), normalized_event: evt,
    status, error_message: errorMessage,
    processed_at: status === 'PROCESSED' ? new Date().toISOString() : null
  };
  const { error } = await admin.from('inbound_events').upsert(record, { onConflict: 'source,provider,external_event_id' });
  if (error) throw error;
}

function safePayload(rawBody) {
  try { return typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody; }
  catch { return { raw: String(rawBody).slice(0,20000) }; }
}
