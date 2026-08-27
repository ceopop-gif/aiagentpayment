import { requireMerchantMember } from '../lib/supabase-admin.js';
import {
  clientIp,
  getRequestAuditContext,
  hashEmail,
  hashIp,
  logAuditEvent,
  recordUserSessionEvent,
  sanitize
} from '../logging/audit-logger.js';

const CLIENT_RATE = new Map();
const CLIENT_WINDOW_MS = 60_000;
const CLIENT_MAX_PER_WINDOW = 180;

const CLIENT_EVENTS = new Set([
  'PAGE_VIEW','PAGE_HIDDEN','UI_CLICK','FORM_SUBMIT','CLIENT_ERROR',
  'CLIENT_UNHANDLED_REJECTION','API_CLIENT_ERROR',
  'AUTH_MAGIC_LINK_REQUESTED','AUTH_LOGIN_SUCCESS','AUTH_SESSION_RESUMED',
  'AUTH_TOKEN_REFRESHED','AUTH_LOGOUT_REQUESTED','AUTH_LOGOUT',
  'STOREFRONT_VIEW','PRODUCT_VIEW','CHECKOUT_STARTED','ORDER_CREATED',
  'PAYMENT_PAGE_VIEW','BACKOFFICE_VIEW'
]);

export async function recordClientActivity({ admin, user = null, body = {}, req }) {
  enforceClientRate(req, body.sessionKey);
  const eventName = normalizeEvent(body.eventName);
  if (!CLIENT_EVENTS.has(eventName) && !eventName.startsWith('CUSTOM.')) {
    throw Object.assign(new Error('CLIENT_EVENT_NOT_ALLOWED'), { code: 'CLIENT_EVENT_NOT_ALLOWED' });
  }

  const sourceArea = normalizeSource(body.sourceArea);
  const context = getRequestAuditContext(req) || {};
  let merchantId = validUuid(body.merchantId);
  let storeId = validUuid(body.storeId);
  let store = null;

  if (user) {
    const resolved = await resolveAuthenticatedContext({ admin, userId:user.id, merchantId, storeId });
    merchantId = resolved.merchantId;
    storeId = resolved.storeId;
  } else {
    merchantId = null;
    if (storeId) {
      const { data, error } = await admin.from('stores')
        .select('id,merchant_id,status,store_slug')
        .eq('id', storeId)
        .maybeSingle();
      if (error) throw error;
      if (data?.status === 'PUBLISHED') store = data;
    } else if (body.storeSlug) {
      const { data, error } = await admin.from('stores')
        .select('id,merchant_id,status,store_slug')
        .eq('store_slug', String(body.storeSlug).slice(0, 180))
        .maybeSingle();
      if (error) throw error;
      if (data?.status === 'PUBLISHED') store = data;
    }

    if (!store && body.resourceType === 'payment_link' && validUuid(body.resourceId)) {
      const { data, error } = await admin.from('payment_links')
        .select('id,merchant_id,store_id,status')
        .eq('id', body.resourceId)
        .maybeSingle();
      if (error) throw error;
      if (data?.status === 'ACTIVE') {
        merchantId = data.merchant_id;
        storeId = data.store_id;
      }
    } else {
      merchantId = store?.merchant_id || null;
      storeId = store?.id || null;
    }
  }

  const metadata = sanitize(body.metadata || {});
  if (eventName === 'AUTH_MAGIC_LINK_REQUESTED') {
    metadata.email_hash = hashEmail(body.email || metadata.email);
    delete metadata.email;
  }

  const result = await logAuditEvent({
    admin,
    eventName: `CLIENT.${eventName}`,
    eventCategory: eventName.startsWith('AUTH_') ? 'AUTH' : eventName.includes('ERROR') ? 'ERROR' : 'ACTIVITY',
    severity: eventName.includes('ERROR') ? 'WARN' : 'INFO',
    sourceArea,
    actorType: user ? 'USER' : (body.actorType === 'CUSTOMER' ? 'CUSTOMER' : 'ANONYMOUS'),
    actorUserId: user?.id || null,
    actorEmail: user?.email || null,
    sessionKey: body.sessionKey || context.sessionKey,
    merchantId,
    storeId,
    requestId: context.requestId,
    traceId: context.traceId,
    route: body.route || context.route,
    action: eventName,
    success: body.success !== false,
    message: cleanText(body.message, 1000) || eventName,
    ipHash: context.ipHash || hashIp(clientIp(req)),
    userAgent: context.userAgent || req.headers['user-agent'],
    referer: body.referer || context.referer,
    clientTimestamp: body.clientTimestamp,
    resourceType: body.resourceType,
    resourceId: body.resourceId,
    metadata
  });

  return { accepted: true, event_id: result.data?.event_id || null };
}

export async function recordAuthActivity({ admin, user = null, body = {}, req }) {
  enforceClientRate(req, body.sessionKey);
  const eventName = normalizeEvent(body.eventName);
  const allowed = new Set([
    'AUTH_LOGIN_SUCCESS','AUTH_SESSION_RESUMED','AUTH_TOKEN_REFRESHED',
    'AUTH_LOGOUT_REQUESTED','AUTH_LOGOUT','AUTH_LOGIN_FAILED'
  ]);
  if (!allowed.has(eventName)) throw new Error('AUTH_EVENT_NOT_ALLOWED');
  if (!user && !['AUTH_LOGIN_FAILED'].includes(eventName)) throw new Error('Unauthorized');

  const context = getRequestAuditContext(req) || {};
  let merchantId = validUuid(body.merchantId);
  let storeId = validUuid(body.storeId);
  if (user) {
    const resolved = await resolveAuthenticatedContext({ admin, userId:user.id, merchantId, storeId });
    merchantId = resolved.merchantId;
    storeId = resolved.storeId;
  }

  const sessionKey = cleanText(body.sessionKey || context.sessionKey, 160);
  const metadata = sanitize(body.metadata || {});
  if (!user && body.email) metadata.email_hash = hashEmail(body.email);

  const result = await logAuditEvent({
    admin,
    eventName: eventName.replace(/^AUTH_/, 'AUTH.'),
    eventCategory: 'AUTH',
    severity: eventName === 'AUTH_LOGIN_FAILED' ? 'WARN' : 'INFO',
    sourceArea: 'AUTH',
    actorType: user ? 'USER' : 'ANONYMOUS',
    actorUserId: user?.id || null,
    actorEmail: user?.email || null,
    sessionKey,
    merchantId,
    storeId,
    requestId: context.requestId,
    traceId: context.traceId,
    route: body.route || context.route,
    action: eventName,
    success: eventName !== 'AUTH_LOGIN_FAILED',
    message: eventName,
    ipHash: context.ipHash || hashIp(clientIp(req)),
    userAgent: context.userAgent || req.headers['user-agent'],
    referer: context.referer,
    clientTimestamp: body.clientTimestamp,
    metadata
  });

  if (user && sessionKey) {
    await recordUserSessionEvent({
      admin,
      eventName,
      sessionKey,
      user,
      merchantId,
      storeId,
      loginSource: body.sourceArea || 'AUTH',
      ipHash: context.ipHash || hashIp(clientIp(req)),
      userAgent: context.userAgent || req.headers['user-agent'],
      metadata: { route: body.route || context.route }
    });
  }

  return { accepted: true, event_id: result.data?.event_id || null };
}

export async function listActivityLogs({ admin, merchantId, userId, filters = {} }) {
  await requireMerchantMember(admin, merchantId, userId);

  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 300);
  let query = admin.from('activity_logs')
    .select(`
      id,event_id,occurred_at,event_name,event_category,severity,source_area,
      actor_type,actor_user_id,actor_email_snapshot,session_key,
      merchant_id,store_id,request_id,trace_id,route,http_method,http_status,
      success,duration_ms,resource_type,resource_id,action,message,
      user_agent,referer,client_timestamp,metadata,before_data,after_data
    `)
    .eq('merchant_id', merchantId)
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (validUuid(filters.storeId)) query = query.eq('store_id', filters.storeId);
  if (validUuid(filters.actorUserId)) query = query.eq('actor_user_id', filters.actorUserId);
  if (filters.sourceArea) query = query.eq('source_area', normalizeSource(filters.sourceArea));
  if (filters.severity) query = query.eq('severity', normalizeSeverity(filters.severity));
  if (filters.eventName) query = query.ilike('event_name', `%${safeSearch(filters.eventName)}%`);
  if (filters.from) query = query.gte('occurred_at', new Date(filters.from).toISOString());
  if (filters.to) query = query.lte('occurred_at', new Date(filters.to).toISOString());

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function listUserSessions({ admin, merchantId, userId, filters = {} }) {
  await requireMerchantMember(admin, merchantId, userId);
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 300);

  let query = admin.from('user_sessions')
    .select(`
      id,session_key,user_id,email_snapshot,merchant_id,store_id,
      login_at,last_seen_at,logout_at,status,login_source,ip_hash,user_agent,metadata
    `)
    .eq('merchant_id', merchantId)
    .order('last_seen_at', { ascending: false })
    .limit(limit);

  if (filters.status) query = query.eq('status', String(filters.status).toUpperCase());
  if (validUuid(filters.storeId)) query = query.eq('store_id', filters.storeId);
  if (validUuid(filters.actorUserId)) query = query.eq('user_id', filters.actorUserId);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function resolveAuthenticatedContext({ admin, userId, merchantId = null, storeId = null }) {
  let resolvedMerchant = validUuid(merchantId);
  let resolvedStore = validUuid(storeId);

  if (resolvedStore) {
    const { data: store, error } = await admin.from('stores')
      .select('id,merchant_id').eq('id', resolvedStore).maybeSingle();
    if (error) throw error;
    if (!store) resolvedStore = null;
    else {
      if (resolvedMerchant && store.merchant_id !== resolvedMerchant) throw new Error('Forbidden: store is not part of merchant');
      resolvedMerchant = store.merchant_id;
    }
  }

  if (resolvedMerchant) {
    await requireMerchantMember(admin, resolvedMerchant, userId);
  } else {
    const { data: membership, error } = await admin.from('merchant_members')
      .select('merchant_id').eq('user_id', userId).order('created_at').limit(1).maybeSingle();
    if (error) throw error;
    resolvedMerchant = membership?.merchant_id || null;
  }

  return { merchantId:resolvedMerchant, storeId:resolvedStore };
}

function enforceClientRate(req, sessionKey) {
  const now = Date.now();
  const rawIp = clientIp(req) || 'unknown';
  const key = `${rawIp}:${String(sessionKey || '').slice(0,80)}`;
  const current = CLIENT_RATE.get(key);

  if (!current || now - current.startedAt >= CLIENT_WINDOW_MS) {
    CLIENT_RATE.set(key, { startedAt: now, count: 1 });
  } else {
    current.count += 1;
    if (current.count > CLIENT_MAX_PER_WINDOW) {
      const error = new Error('CLIENT_LOG_RATE_LIMITED');
      error.code = 'CLIENT_LOG_RATE_LIMITED';
      throw error;
    }
  }

  if (CLIENT_RATE.size > 10_000) {
    for (const [entryKey, entry] of CLIENT_RATE) {
      if (now - entry.startedAt > CLIENT_WINDOW_MS * 2) CLIENT_RATE.delete(entryKey);
    }
  }
}

function normalizeEvent(value) {
  const event = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '_').slice(0, 160);
  if (!event) throw new Error('eventName is required');
  return event;
}

function normalizeSource(value) {
  const source = String(value || '').toUpperCase();
  const allowed = ['AUTH','FRONTEND','BACKOFFICE','API','DATABASE','AI','PAYMENT','PAYOUT','BILLING','WEBHOOK','SECURITY','SYSTEM'];
  return allowed.includes(source) ? source : 'FRONTEND';
}

function normalizeSeverity(value) {
  const severity = String(value || '').toUpperCase();
  return ['DEBUG','INFO','NOTICE','WARN','ERROR','CRITICAL'].includes(severity) ? severity : 'INFO';
}

function validUuid(value) {
  const text = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function cleanText(value, max = 1000) {
  if (value == null) return null;
  return String(value).replace(/[\u0000-\u001F]/g, '').slice(0, max);
}

function safeSearch(value) {
  return String(value || '').replace(/[%_,()]/g, '').slice(0, 120);
}
