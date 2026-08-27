import { requireMerchantMember } from '../lib/supabase-admin.js';
import { createWebhookEndpoint, deliverToEndpoint } from '../webhooks/outbound.js';

export async function registerWebhook({ admin, merchantId, userId, input, secretStore }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER','ADMIN']);
  if (!input?.name?.trim()) throw new Error('Webhook name is required');
  if (!input?.url?.trim()) throw new Error('Webhook URL is required');
  if (!Array.isArray(input.events) || !input.events.length) throw new Error('At least one subscribed event is required');

  return createWebhookEndpoint({
    admin,
    merchantId,
    name: input.name.trim(),
    url: input.url.trim(),
    events: input.events,
    secretStore
  });
}

export async function testWebhook({ admin, merchantId, userId, endpointId, secretStore }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER','ADMIN']);
  const { data: endpoint, error } = await admin.from('webhook_endpoints')
    .select('*').eq('id', endpointId).eq('merchant_id', merchantId).single();
  if (error) throw error;

  const event = {
    id: `evt_test_${Date.now()}`,
    type: 'webhook.test',
    merchant_id: merchantId,
    resource_type: 'webhook_endpoint',
    resource_id: endpointId,
    occurred_at: new Date().toISOString(),
    data: { message: 'AnnyPay webhook test', endpoint_id: endpointId }
  };

  return deliverToEndpoint({ admin, endpoint, event, secretStore, attempt: 1 });
}

export async function redeliverWebhook({ admin, merchantId, userId, deliveryId, secretStore }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER','ADMIN']);
  const { data: delivery, error } = await admin.from('webhook_deliveries')
    .select('*, webhook_endpoints(*)')
    .eq('id', deliveryId).eq('merchant_id', merchantId).single();
  if (error) throw error;

  const endpoint = delivery.webhook_endpoints;
  const event = {
    id: delivery.event_id,
    type: delivery.event_type,
    merchant_id: merchantId,
    resource_type: null,
    resource_id: delivery.resource_id,
    occurred_at: delivery.created_at,
    data: delivery.payload?.data ?? delivery.payload
  };

  return deliverToEndpoint({
    admin,
    endpoint,
    event,
    secretStore,
    attempt: Number(delivery.attempt || 0) + 1
  });
}
