import { requireMerchantMember } from '../lib/supabase-admin.js';
import { makeEvent, publishEvent } from '../events/event-bus.js';

function slugify(value) {
  const base = String(value || '').toLowerCase().trim()
    .normalize('NFKD').replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return base || `store-${Date.now().toString(36)}`;
}

export async function createStore({ admin, merchantId, userId, input, dispatchOutbound, runAutomations }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN', 'STAFF']);
  if (!input?.storeName?.trim()) throw new Error('storeName is required');

  const record = {
    merchant_id: merchantId,
    store_name: input.storeName.trim(),
    store_slug: input.storeSlug?.trim() || slugify(input.storeName),
    description: input.description?.trim() || null,
    logo_url: input.logoUrl || null,
    theme: input.theme || {},
    currency: input.currency || 'THB',
    domain: input.domain || null,
    status: 'DRAFT'
  };

  const { data, error } = await admin.from('stores').insert(record).select('*').single();
  if (error) throw error;

  const event = makeEvent({ merchantId, type: 'store.created', resourceType: 'store', resourceId: data.id, data });
  await publishEvent({ admin, event, dispatchOutbound, runAutomations });
  return data;
}

export async function publishStore({ admin, merchantId, userId, storeId, dispatchOutbound, runAutomations }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN']);
  const { data: store, error: readError } = await admin.from('stores')
    .select('*').eq('id', storeId).eq('merchant_id', merchantId).single();
  if (readError) throw readError;
  if (!store.store_name || !store.store_slug) throw new Error('Store is missing required fields');

  const { data, error } = await admin.from('stores')
    .update({ status: 'PUBLISHED', updated_at: new Date().toISOString() })
    .eq('id', storeId).eq('merchant_id', merchantId).select('*').single();
  if (error) throw error;

  const event = makeEvent({ merchantId, type: 'store.published', resourceType: 'store', resourceId: data.id, data });
  await publishEvent({ admin, event, dispatchOutbound, runAutomations });
  return data;
}
