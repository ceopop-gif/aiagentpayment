import { requireMerchantMember } from '../lib/supabase-admin.js';
import { makeEvent, publishEvent } from '../events/event-bus.js';

export async function createProduct({ admin, merchantId, userId, input, dispatchOutbound, runAutomations }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN', 'STAFF']);
  if (!input?.storeId) throw new Error('storeId is required');
  if (!input?.productName?.trim()) throw new Error('productName is required');
  if (Number(input.price) < 0 || Number.isNaN(Number(input.price))) throw new Error('Valid price is required');

  const { data: store, error: storeError } = await admin.from('stores')
    .select('id').eq('id', input.storeId).eq('merchant_id', merchantId).single();
  if (storeError || !store) throw new Error('Store not found in merchant');

  const record = {
    merchant_id: merchantId,
    store_id: input.storeId,
    product_name: input.productName.trim(),
    sku: input.sku?.trim() || null,
    short_description: input.shortDescription?.trim() || null,
    description: input.description?.trim() || null,
    price: Number(input.price),
    sale_price: input.salePrice == null || input.salePrice === '' ? null : Number(input.salePrice),
    stock: Number(input.stock || 0),
    seo_title: input.seoTitle?.trim() || null,
    seo_description: input.seoDescription?.trim() || null,
    status: input.status || 'DRAFT'
  };

  const { data, error } = await admin.from('products').insert(record).select('*').single();
  if (error) throw error;

  const event = makeEvent({ merchantId, type: 'product.created', resourceType: 'product', resourceId: data.id, data });
  await publishEvent({ admin, event, dispatchOutbound, runAutomations });
  return data;
}

export async function updateProduct({ admin, merchantId, userId, productId, patch, dispatchOutbound, runAutomations }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN', 'STAFF']);
  const allowed = ['product_name','sku','short_description','description','price','sale_price','stock','seo_title','seo_description','status','track_stock'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  clean.updated_at = new Date().toISOString();

  const { data, error } = await admin.from('products').update(clean)
    .eq('id', productId).eq('merchant_id', merchantId).select('*').single();
  if (error) throw error;

  const event = makeEvent({ merchantId, type: 'product.updated', resourceType: 'product', resourceId: data.id, data });
  await publishEvent({ admin, event, dispatchOutbound, runAutomations });
  return data;
}
