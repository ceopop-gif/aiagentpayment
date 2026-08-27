import crypto from 'node:crypto';

export function makeEvent({ merchantId, type, resourceType, resourceId, data = {} }) {
  return {
    id: `evt_${crypto.randomUUID().replaceAll('-', '')}`,
    type,
    merchant_id: merchantId,
    resource_type: resourceType || null,
    resource_id: resourceId ? String(resourceId) : null,
    occurred_at: new Date().toISOString(),
    data
  };
}

export async function persistEvent(admin, event) {
  const { error } = await admin.from('system_events').insert({
    id: event.id,
    merchant_id: event.merchant_id,
    event_type: event.type,
    resource_type: event.resource_type,
    resource_id: event.resource_id,
    payload: event.data,
    occurred_at: event.occurred_at
  });
  if (error) throw error;
  return event;
}

export async function publishEvent({ admin, event, dispatchOutbound, runAutomations }) {
  await persistEvent(admin, event);

  // These follow-up operations should be queue-backed in production.
  const work = [];
  if (dispatchOutbound) work.push(dispatchOutbound(event));
  if (runAutomations) work.push(runAutomations(event));

  const settled = await Promise.allSettled(work);
  return { event, followUps: settled };
}
