import { requireMerchantMember } from '../lib/supabase-admin.js';
import { makeEvent, publishEvent } from '../events/event-bus.js';

function slugify(value) {
  return String(value || '').toLowerCase().trim()
    .normalize('NFKD').replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `page-${Date.now().toString(36)}`;
}

export async function createSalePage({ admin, merchantId, userId, input, dispatchOutbound, runAutomations }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN', 'STAFF']);
  if (!input?.storeId) throw new Error('storeId is required');
  if (!input?.productId) throw new Error('productId is required');

  const { data: product, error: productError } = await admin.from('products')
    .select('id,store_id,product_name,short_description,description,price,sale_price')
    .eq('id', input.productId)
    .eq('store_id', input.storeId)
    .eq('merchant_id', merchantId)
    .single();
  if (productError) throw productError;

  const approvedIds = input.contentAssetIds || [];
  let assets = [];
  if (approvedIds.length) {
    const { data, error } = await admin.from('content_assets')
      .select('id,content_type,content,status')
      .eq('merchant_id', merchantId)
      .in('id', approvedIds);
    if (error) throw error;
    assets = data || [];
  }

  const contentByType = Object.fromEntries(assets.map(x => [x.content_type, x.content]));
  const headline = input.headline || contentByType.HEADLINE || product.product_name;
  const pageContent = input.content || {
    hero: { headline, subheadline: contentByType.SALEPAGE_COPY || product.short_description || null },
    product: { name: product.product_name, description: product.description },
    faq: contentByType.FAQ || null,
    promotion: contentByType.PROMOTION || null,
    cta: 'สั่งซื้อเลย'
  };

  const record = {
    merchant_id: merchantId,
    store_id: input.storeId,
    product_id: input.productId,
    slug: input.slug?.trim() || slugify(product.product_name),
    headline,
    content: pageContent,
    status: 'DRAFT'
  };

  const { data, error } = await admin.from('salepages').insert(record).select('*').single();
  if (error) throw error;

  const event = makeEvent({ merchantId, type: 'salepage.created', resourceType: 'salepage', resourceId: data.id, data });
  await publishEvent({ admin, event, dispatchOutbound, runAutomations });
  return data;
}

export async function publishSalePage({ admin, merchantId, userId, salePageId, dispatchOutbound, runAutomations }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN']);

  const { data: page, error: readError } = await admin.from('salepages')
    .select('id,store_id,product_id,slug,headline,status')
    .eq('id', salePageId).eq('merchant_id', merchantId).single();
  if (readError) throw readError;
  if (!page.product_id) throw new Error('SalePage must have a product before publish');

  const { data: store, error: storeError } = await admin.from('stores')
    .select('id,status,store_slug').eq('id', page.store_id).eq('merchant_id', merchantId).single();
  if (storeError) throw storeError;
  if (store.status !== 'PUBLISHED') throw new Error('Store must be PUBLISHED before SalePage');

  const { data, error } = await admin.from('salepages')
    .update({ status: 'PUBLISHED', published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', salePageId).eq('merchant_id', merchantId).select('*').single();
  if (error) throw error;

  const event = makeEvent({ merchantId, type: 'salepage.published', resourceType: 'salepage', resourceId: data.id, data: {
    id: data.id,
    store_id: data.store_id,
    product_id: data.product_id,
    slug: data.slug,
    public_path: `/sale.html?store=${encodeURIComponent(store.store_slug)}&page=${encodeURIComponent(data.slug)}`
  }});
  await publishEvent({ admin, event, dispatchOutbound, runAutomations });
  return { ...data, store_slug: store.store_slug };
}
