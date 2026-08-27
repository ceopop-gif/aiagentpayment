import crypto from 'node:crypto';
import { requireMerchantMember } from '../lib/supabase-admin.js';
import { makeEvent, publishEvent } from '../events/event-bus.js';

export async function createPaymentLink({ admin, merchantId, userId, input, dispatchOutbound, runAutomations }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER','ADMIN','STAFF']);
  const amount = Number(input?.amount);
  if (!amount || amount <= 0) throw new Error('Valid amount is required');
  if (!input?.description?.trim()) throw new Error('description is required');

  const slug = input.slug?.trim() || `pay_${crypto.randomUUID().replaceAll('-','').slice(0,16)}`;
  const { data, error } = await admin.from('payment_links').insert({
    merchant_id: merchantId,
    store_id: input.storeId || null,
    slug,
    description: input.description.trim(),
    amount,
    currency: input.currency || 'THB',
    status: 'ACTIVE',
    expires_at: input.expiresAt || null
  }).select('*').single();
  if (error) throw error;

  const event = makeEvent({ merchantId, type:'payment_link.created', resourceType:'payment_link', resourceId:data.id, data:{ id:data.id, slug:data.slug, amount:data.amount, currency:data.currency }});
  await publishEvent({ admin, event, dispatchOutbound, runAutomations });
  return { ...data, public_path: `/pay.html?link=${encodeURIComponent(data.slug)}` };
}
