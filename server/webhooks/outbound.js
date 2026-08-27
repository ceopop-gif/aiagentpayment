import crypto from 'node:crypto';
import { promises as dns } from 'node:dns';

const RETRY_SECONDS = [60, 300, 1800, 7200, 21600];

function isPrivateAddress(address = '') {
  return address === '::1' ||
    address.startsWith('127.') ||
    address.startsWith('10.') ||
    address.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
    address.startsWith('169.254.') ||
    address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:');
}

export async function assertSafeWebhookUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('Webhook URL must use HTTPS');
  if (['localhost', '0.0.0.0'].includes(url.hostname) || url.hostname.endsWith('.local')) {
    throw new Error('Local/private webhook host is not allowed');
  }

  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(x => isPrivateAddress(x.address))) {
    throw new Error('Webhook host resolves to a private/reserved address');
  }
  return url;
}

export function signWebhook({ secret, timestamp, rawBody }) {
  if (!secret) throw new Error('Signing secret is required');
  const signed = `${timestamp}.${rawBody}`;
  return `v1=${crypto.createHmac('sha256', secret).update(signed).digest('hex')}`;
}

export async function createWebhookEndpoint({ admin, merchantId, name, url, events, secretStore }) {
  await assertSafeWebhookUrl(url);
  const secret = crypto.randomBytes(32).toString('hex');
  const secretRef = await secretStore.put(`webhook/${merchantId}/${crypto.randomUUID()}`, secret);
  const secretHint = `${secret.slice(0, 4)}…${secret.slice(-4)}`;

  const { data, error } = await admin.from('webhook_endpoints').insert({
    merchant_id: merchantId,
    name,
    url,
    subscribed_events: events || [],
    status: 'ACTIVE',
    signing_secret_ref: secretRef,
    secret_hint: secretHint
  }).select('id,merchant_id,name,url,subscribed_events,status,secret_hint,created_at').single();

  if (error) throw error;
  return { endpoint: data, signingSecret: secret };
}

export async function dispatchOutboundEvent({ admin, event, secretStore, fetchImpl = fetch }) {
  const { data: endpoints, error } = await admin
    .from('webhook_endpoints')
    .select('*')
    .eq('merchant_id', event.merchant_id)
    .eq('status', 'ACTIVE')
    .contains('subscribed_events', [event.type]);
  if (error) throw error;

  return Promise.allSettled((endpoints || []).map(endpoint =>
    deliverToEndpoint({ admin, endpoint, event, secretStore, fetchImpl, attempt: 1 })
  ));
}

export async function deliverToEndpoint({ admin, endpoint, event, secretStore, fetchImpl = fetch, attempt = 1 }) {
  await assertSafeWebhookUrl(endpoint.url);
  const secret = await secretStore.get(endpoint.signing_secret_ref);
  if (!secret) throw new Error('Webhook signing secret not found');

  const body = JSON.stringify({
    id: event.id,
    type: event.type,
    merchant_id: event.merchant_id,
    resource_type: event.resource_type,
    resource_id: event.resource_id,
    occurred_at: event.occurred_at,
    data: event.data
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signWebhook({ secret, timestamp, rawBody: body });

  const { data: delivery, error: insertError } = await admin.from('webhook_deliveries').insert({
    merchant_id: event.merchant_id,
    endpoint_id: endpoint.id,
    event_id: event.id,
    event_type: event.type,
    resource_id: event.resource_id,
    payload: JSON.parse(body),
    attempt,
    status: 'DELIVERING'
  }).select('*').single();
  if (insertError) throw insertError;

  try {
    const response = await fetchImpl(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'AnnyPay-Webhook/1.0',
        'annypay-event-id': event.id,
        'annypay-event': event.type,
        'annypay-timestamp': timestamp,
        'annypay-signature': signature
      },
      body,
      signal: AbortSignal.timeout(10000)
    });

    const responseText = (await response.text()).slice(0, 1000);
    if (!response.ok) throw Object.assign(new Error(`Webhook returned HTTP ${response.status}`), {
      responseStatus: response.status,
      responseText
    });

    await admin.from('webhook_deliveries').update({
      status: 'SUCCESS',
      response_status: response.status,
      response_summary: responseText,
      delivered_at: new Date().toISOString()
    }).eq('id', delivery.id);

    await admin.from('webhook_endpoints').update({
      failure_count: 0,
      last_success_at: new Date().toISOString()
    }).eq('id', endpoint.id);

    return { deliveryId: delivery.id, success: true };
  } catch (error) {
    const nextDelay = RETRY_SECONDS[attempt - 1];
    const dead = !nextDelay;
    const nextRetry = dead ? null : new Date(Date.now() + nextDelay * 1000).toISOString();

    await admin.from('webhook_deliveries').update({
      status: dead ? 'DEAD_LETTER' : 'FAILED',
      response_status: error.responseStatus || null,
      response_summary: (error.responseText || error.message || 'Delivery failed').slice(0, 1000),
      next_retry_at: nextRetry
    }).eq('id', delivery.id);

    await admin.from('webhook_endpoints').update({
      failure_count: Number(endpoint.failure_count || 0) + 1,
      last_failure_at: new Date().toISOString()
    }).eq('id', endpoint.id);

    return { deliveryId: delivery.id, success: false, deadLetter: dead, nextRetry };
  }
}
