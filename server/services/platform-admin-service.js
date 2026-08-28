import { requireMerchantMember } from '../lib/supabase-admin.js';

export async function requirePlatformAdmin(admin, userId, allowedRoles = []) {
  if (!userId) throw new Error('Unauthorized');
  const { data, error } = await admin.from('platform_admins')
    .select('role,status').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data || data.status !== 'ACTIVE') throw new Error('Forbidden: platform admin required');
  if (allowedRoles.length && !allowedRoles.includes(data.role)) {
    throw new Error(`Forbidden: platform role ${data.role} cannot perform this action`);
  }
  return data.role;
}

export async function listPlatformMerchants({ admin, userId, filters = {} }) {
  await requirePlatformAdmin(admin, userId);
  let q = admin.from('merchants')
    .select('id,business_name,business_type,phone,email,merchant_status,kyc_status,payment_status,created_at,updated_at,merchant_provisioning(source,onboarding_status,created_at)')
    .order('created_at', { ascending: false });
  if (filters.status) q = q.eq('merchant_status', filters.status);
  if (filters.kycStatus) q = q.eq('kyc_status', filters.kycStatus);
  if (filters.paymentStatus) q = q.eq('payment_status', filters.paymentStatus);
  if (filters.limit) q = q.limit(Math.min(Number(filters.limit), 200));
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function createMerchantByAdmin({ admin, userId, input }) {
  const role = await requirePlatformAdmin(admin, userId, ['OWNER','ADMIN']);
  if (!input?.businessName?.trim()) throw new Error('businessName is required');

  // In this phase owner auth signup is intentionally deferred. The merchant may be
  // created without a member only when the database schema allows it. If the current
  // merchants.owner_user_id column is NOT NULL, pass an existing ownerUserId.
  if (!input.ownerUserId) {
    throw Object.assign(new Error('ownerUserId is required until public signup/invitation flow is implemented'), {
      code: 'MERCHANT_OWNER_REQUIRED',
      userMessage: 'ระยะนี้ต้องเลือก User เจ้าของที่มีอยู่แล้วก่อนสร้าง Merchant จริง'
    });
  }

  const { data: merchant, error } = await admin.from('merchants').insert({
    owner_user_id: input.ownerUserId,
    business_name: input.businessName.trim(),
    business_type: input.businessType || null,
    phone: input.phone || null,
    email: input.email || null,
    merchant_status: 'PROFILE_CREATED',
    kyc_status: 'PENDING',
    payment_status: 'NOT_CONNECTED'
  }).select('*').single();
  if (error) throw error;

  const { error: memberError } = await admin.from('merchant_members').upsert({
    merchant_id: merchant.id,
    user_id: input.ownerUserId,
    role: 'OWNER'
  });
  if (memberError) throw memberError;

  const { error: provisioningError } = await admin.from('merchant_provisioning').insert({
    merchant_id: merchant.id,
    created_by_admin: userId,
    source: 'ADMIN_MANUAL',
    onboarding_status: 'PROFILE_CREATED',
    metadata: { platform_role: role, plan_code: input.planCode || null }
  });
  if (provisioningError) throw provisioningError;

  let store = null;
  if (input.createFirstStore !== false) {
    const slugBase = slugify(input.storeName || input.businessName);
    const { data: createdStore, error: storeError } = await admin.from('stores').insert({
      merchant_id: merchant.id,
      store_name: input.storeName || input.businessName.trim(),
      store_slug: `${slugBase}-${merchant.id.slice(0, 6)}`,
      status: 'DRAFT'
    }).select('*').single();
    if (storeError) throw storeError;
    store = createdStore;
  }

  return { merchant, store, next_step: 'KYC_AND_PAYMENT_ONBOARDING' };
}

export async function updateMerchantByAdmin({ admin, userId, merchantId, patch }) {
  await requirePlatformAdmin(admin, userId, ['OWNER','ADMIN','RISK','SUPPORT']);
  const allowed = ['business_name','business_type','phone','email','merchant_status','kyc_status','payment_status'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([key]) => allowed.includes(key)));
  clean.updated_at = new Date().toISOString();
  const { data, error } = await admin.from('merchants').update(clean).eq('id', merchantId).select('*').single();
  if (error) throw error;
  return data;
}

export async function getMerchantAdminSnapshot({ admin, userId, merchantId }) {
  await requirePlatformAdmin(admin, userId);
  const [merchantRes, storeRes, productRes, orderRes, channelRes, conversationRes] = await Promise.all([
    admin.from('merchants').select('*').eq('id', merchantId).single(),
    admin.from('stores').select('*').eq('merchant_id', merchantId).order('created_at'),
    admin.from('products').select('id,store_id,product_name,price,stock,status').eq('merchant_id', merchantId).order('created_at',{ascending:false}).limit(100),
    admin.from('orders').select('id,order_no,total,payment_status,order_status,created_at').eq('merchant_id', merchantId).order('created_at',{ascending:false}).limit(100),
    admin.from('messaging_channels').select('id,provider,display_name,status,ai_mode,store_id').eq('merchant_id', merchantId),
    admin.from('omni_conversations').select('id,channel_id,contact_id,status,ai_mode,sales_stage,last_message_at').eq('merchant_id', merchantId).order('last_message_at',{ascending:false}).limit(100)
  ]);
  [merchantRes, storeRes, productRes, orderRes, channelRes, conversationRes].forEach(r => { if (r.error) throw r.error; });
  return {
    merchant: merchantRes.data,
    stores: storeRes.data || [],
    products: productRes.data || [],
    orders: orderRes.data || [],
    channels: channelRes.data || [],
    conversations: conversationRes.data || []
  };
}

function slugify(value) {
  return String(value || 'store').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'store';
}
