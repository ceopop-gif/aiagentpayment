import crypto from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const CONTEXT = Symbol.for('annypay.request.audit');
const SESSION_TOUCH_MS = 5 * 60 * 1000;
const sessionTouches = new Map();
let fileQueue = Promise.resolve();

const SENSITIVE_KEY = /^(password|password_hash|secret|api[_-]?key|authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|service[_-]?role|private[_-]?key|webhook[_-]?secret|account[_-]?number|card[_-]?number|cvv|raw[_-]?body)$/i;

export function startRequestAudit({ admin, req, res }) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const requestId = cleanText(req.headers['x-request-id'], 128) || crypto.randomUUID();
  const traceId = cleanText(req.headers['x-trace-id'], 128) || requestId;
  const sessionKey = cleanText(req.headers['x-annypay-session'], 160) || null;
  const context = {
    admin,
    requestId,
    traceId,
    sessionKey,
    startedAt: Date.now(),
    route: url.pathname,
    query: url.search,
    method: req.method || 'GET',
    sourceArea: inferSourceArea(url.pathname),
    actorType: 'ANONYMOUS',
    actorUserId: null,
    actorEmail: null,
    merchantId: validUuid(url.searchParams.get('merchantId')),
    storeId: validUuid(url.searchParams.get('storeId')),
    resourceType: null,
    resourceId: null,
    action: null,
    error: null,
    ipHash: hashIp(clientIp(req)),
    userAgent: cleanText(req.headers['user-agent'], 500),
    referer: cleanText(req.headers.referer || req.headers.referrer, 1000)
  };
  req[CONTEXT] = context;
  res.setHeader('x-request-id', requestId);

  res.once('finish', () => {
    void completeRequestAudit({ admin, req, res }).catch(error => {
      console.error(JSON.stringify({
        level: 'ERROR',
        event: 'AUDIT.REQUEST_COMPLETE_FAILED',
        request_id: requestId,
        error: error.message
      }));
    });
  });
  return context;
}

export function enrichRequestAudit(req, input = {}) {
  const context = req?.[CONTEXT];
  if (!context || !input || typeof input !== 'object') return context;
  context.merchantId = validUuid(input.merchantId || input.merchant_id) || context.merchantId;
  context.storeId = validUuid(input.storeId || input.store_id) || context.storeId;
  context.resourceType = cleanText(input.resourceType || input.resource_type, 80) || context.resourceType;
  context.resourceId = cleanText(
    input.resourceId || input.resource_id || input.orderId || input.withdrawalId ||
    input.payoutAccountId || input.planId || input.packId,
    180
  ) || context.resourceId;
  context.action = cleanText(input.action || input.intent, 120) || context.action;
  return context;
}

export function setRequestActor(req, user, extra = {}) {
  const context = req?.[CONTEXT];
  if (!context || !user) return context;
  context.actorType = 'USER';
  context.actorUserId = validUuid(user.id);
  context.actorEmail = cleanText(user.email, 320);
  context.merchantId = validUuid(extra.merchantId) || context.merchantId;
  context.storeId = validUuid(extra.storeId) || context.storeId;
  return context;
}

export function setRequestProviderActor(req, provider) {
  const context = req?.[CONTEXT];
  if (!context) return context;
  context.actorType = 'PROVIDER';
  context.action = cleanText(provider, 120) || context.action;
  return context;
}

export function markRequestError(req, error) {
  const context = req?.[CONTEXT];
  if (context) context.error = error;
}

export function getRequestAuditContext(req) {
  return req?.[CONTEXT] || null;
}

export async function completeRequestAudit({ admin, req, res }) {
  const context = req?.[CONTEXT];
  if (!context || context.completed) return;
  context.completed = true;

  if (!shouldPersistRequest(context.route)) return;

  const status = Number(res.statusCode || 0);
  const success = status > 0 && status < 400;
  const durationMs = Math.max(0, Date.now() - context.startedAt);
  const eventName = context.route.startsWith('/api/')
    ? 'API.REQUEST'
    : 'PAGE.SERVER_REQUEST';

  await logAuditEvent({
    admin,
    eventName,
    eventCategory: context.route.startsWith('/api/') ? 'API_ACCESS' : 'PAGE_ACCESS',
    severity: status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO',
    sourceArea: context.sourceArea,
    actorType: context.actorType,
    actorUserId: context.actorUserId,
    actorEmail: context.actorEmail,
    sessionKey: context.sessionKey,
    merchantId: context.merchantId,
    storeId: context.storeId,
    requestId: context.requestId,
    traceId: context.traceId,
    route: context.route,
    httpMethod: context.method,
    httpStatus: status,
    success,
    durationMs,
    resourceType: context.resourceType,
    resourceId: context.resourceId,
    action: context.action || context.method,
    message: context.error ? cleanText(context.error.message, 1000) : `${context.method} ${context.route} → ${status}`,
    ipHash: context.ipHash,
    userAgent: context.userAgent,
    referer: context.referer,
    metadata: {
      query_present: Boolean(context.query),
      error_code: context.error?.code || null
    }
  });

  if (context.actorUserId && context.sessionKey) {
    await touchUserSession({
      admin,
      sessionKey: context.sessionKey,
      userId: context.actorUserId,
      email: context.actorEmail,
      merchantId: context.merchantId,
      storeId: context.storeId,
      loginSource: context.sourceArea,
      ipHash: context.ipHash,
      userAgent: context.userAgent
    });
  }
}

export async function logAuditEvent({
  admin,
  eventName,
  eventCategory = 'ACTIVITY',
  severity = 'INFO',
  sourceArea = 'SYSTEM',
  actorType = 'SYSTEM',
  actorUserId = null,
  actorEmail = null,
  sessionKey = null,
  merchantId = null,
  storeId = null,
  requestId = null,
  traceId = null,
  route = null,
  httpMethod = null,
  httpStatus = null,
  success = null,
  durationMs = null,
  resourceType = null,
  resourceId = null,
  action = null,
  message = null,
  ipHash = null,
  userAgent = null,
  referer = null,
  clientTimestamp = null,
  metadata = {},
  beforeData = null,
  afterData = null,
  occurredAt = null
}) {
  const record = {
    occurred_at: occurredAt || new Date().toISOString(),
    event_name: cleanText(eventName, 180) || 'UNKNOWN',
    event_category: enumValue(eventCategory, ['ACTIVITY','AUTH','API_ACCESS','PAGE_ACCESS','DATA_CHANGE','SECURITY','ERROR','BUSINESS'], 'ACTIVITY'),
    severity: enumValue(severity, ['DEBUG','INFO','NOTICE','WARN','ERROR','CRITICAL'], 'INFO'),
    source_area: enumValue(sourceArea, ['AUTH','FRONTEND','BACKOFFICE','API','DATABASE','AI','PAYMENT','PAYOUT','BILLING','WEBHOOK','SECURITY','SYSTEM'], 'SYSTEM'),
    actor_type: enumValue(actorType, ['USER','CUSTOMER','ANONYMOUS','AI','SYSTEM','PROVIDER'], 'SYSTEM'),
    actor_user_id: validUuid(actorUserId),
    actor_email_snapshot: cleanText(actorEmail, 320),
    session_key: cleanText(sessionKey, 160),
    merchant_id: validUuid(merchantId),
    store_id: validUuid(storeId),
    request_id: cleanText(requestId, 128),
    trace_id: cleanText(traceId, 128),
    route: cleanText(route, 1000),
    http_method: cleanText(httpMethod, 16),
    http_status: Number.isInteger(Number(httpStatus)) ? Number(httpStatus) : null,
    success: typeof success === 'boolean' ? success : null,
    duration_ms: Number.isFinite(Number(durationMs)) ? Math.max(0, Math.round(Number(durationMs))) : null,
    resource_type: cleanText(resourceType, 120),
    resource_id: cleanText(resourceId, 220),
    action: cleanText(action, 180),
    message: cleanText(message, 2000),
    ip_hash: cleanText(ipHash, 128),
    user_agent: cleanText(userAgent, 500),
    referer: cleanText(referer, 1000),
    client_timestamp: validTimestamp(clientTimestamp),
    metadata: sanitize(metadata),
    before_data: beforeData == null ? null : sanitize(beforeData),
    after_data: afterData == null ? null : sanitize(afterData)
  };

  writeStructuredLog(record);

  if (!admin) return { record, stored: false };
  try {
    const { data, error } = await admin.from('activity_logs').insert(record).select('id,event_id,occurred_at').single();
    if (error) throw error;
    return { record, stored: true, data };
  } catch (error) {
    console.error(JSON.stringify({
      level: 'ERROR',
      event: 'AUDIT.DB_WRITE_FAILED',
      original_event: record.event_name,
      request_id: record.request_id,
      error: error.message
    }));
    return { record, stored: false, error: error.message };
  }
}

export async function recordUserSessionEvent({
  admin,
  eventName,
  sessionKey,
  user,
  merchantId = null,
  storeId = null,
  loginSource = null,
  ipHash = null,
  userAgent = null,
  metadata = {}
}) {
  if (!admin || !user?.id || !sessionKey) return;

  const now = new Date().toISOString();
  const logout = /LOGOUT|SIGNED_OUT|REVOKED/.test(String(eventName || '').toUpperCase());

  if (logout) {
    await admin.from('user_sessions').update({
      status: /REVOKED/.test(String(eventName).toUpperCase()) ? 'REVOKED' : 'LOGGED_OUT',
      logout_at: now,
      last_seen_at: now,
      updated_at: now
    }).eq('session_key', sessionKey).eq('user_id', user.id);
    return;
  }

  const { data: existing, error: findError } = await admin.from('user_sessions')
    .select('id').eq('session_key', sessionKey).maybeSingle();
  if (findError) throw findError;

  const patch = {
    user_id: user.id,
    email_snapshot: cleanText(user.email, 320),
    merchant_id: validUuid(merchantId),
    store_id: validUuid(storeId),
    last_seen_at: now,
    status: 'ACTIVE',
    login_source: cleanText(loginSource, 80),
    ip_hash: cleanText(ipHash, 128),
    user_agent: cleanText(userAgent, 500),
    metadata: sanitize(metadata),
    updated_at: now
  };

  if (existing) {
    const { error } = await admin.from('user_sessions').update(patch).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await admin.from('user_sessions').insert({
      session_key: sessionKey,
      login_at: now,
      created_at: now,
      ...patch
    });
    if (error) throw error;
  }
}

export async function touchUserSession(input) {
  const key = `${input.userId}:${input.sessionKey}`;
  const last = sessionTouches.get(key) || 0;
  if (Date.now() - last < SESSION_TOUCH_MS) return;
  sessionTouches.set(key, Date.now());
  try {
    await recordUserSessionEvent({
      ...input,
      eventName: 'AUTH_SESSION_ACTIVITY',
      user: { id: input.userId, email: input.email }
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'WARN',
      event: 'AUDIT.SESSION_TOUCH_FAILED',
      error: error.message
    }));
  }
}

export function hashEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function hashIp(ip) {
  const value = String(ip || '').trim();
  const secret = process.env.LOG_IP_HASH_KEY || null;
  if (!value || !secret) return null;
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

export function clientIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '').split(',')[0];
  return cleanText(first || req?.socket?.remoteAddress, 128);
}

export function sanitize(value, depth = 0) {
  if (depth > 6) return '[MAX_DEPTH]';
  if (value == null) return value;
  if (typeof value === 'string') return cleanText(value, 4000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(v => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value).slice(0, 150)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitize(val, depth + 1);
    }
    return out;
  }
  return cleanText(String(value), 1000);
}

function writeStructuredLog(record) {
  const entry = {
    timestamp: record.occurred_at,
    level: record.severity,
    event: record.event_name,
    source: record.source_area,
    actor_type: record.actor_type,
    actor_user_id: record.actor_user_id,
    merchant_id: record.merchant_id,
    store_id: record.store_id,
    request_id: record.request_id,
    route: record.route,
    status: record.http_status,
    success: record.success,
    message: record.message,
    metadata: record.metadata
  };
  const line = JSON.stringify(entry);
  if (record.severity === 'ERROR' || record.severity === 'CRITICAL') console.error(line);
  else if (record.severity === 'WARN') console.warn(line);
  else console.log(line);

  const path = process.env.ANNYPAY_LOG_FILE;
  if (path) {
    fileQueue = fileQueue.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, line + '\n', 'utf8');
    }).catch(error => {
      console.error(JSON.stringify({ level: 'ERROR', event: 'AUDIT.FILE_WRITE_FAILED', error: error.message }));
    });
  }
}

function shouldPersistRequest(route = '') {
  if (route.startsWith('/assets/')) return false;
  return !/\.(css|js|png|jpe?g|webp|svg|ico|map|woff2?)$/i.test(route);
}

function inferSourceArea(route = '') {
  if (route.startsWith('/api/webhooks/')) return 'WEBHOOK';
  if (route.startsWith('/api/ai/')) return 'AI';
  if (route.startsWith('/api/payout/') || route.startsWith('/api/withdrawals')) return 'PAYOUT';
  if (route.startsWith('/api/billing/')) return 'BILLING';
  if (route.startsWith('/api/logs') || route.startsWith('/api/sessions')) return 'SECURITY';
  if (route.startsWith('/api/')) return 'API';
  if (/backoffice|billing|payouts|commerce-admin|activity-logs/.test(route)) return 'BACKOFFICE';
  if (/store\.html|sale\.html|pay\.html/.test(route)) return 'FRONTEND';
  if (/index\.html|^\/$/.test(route)) return 'AUTH';
  return 'SYSTEM';
}

function validUuid(value) {
  const text = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function validTimestamp(value) {
  if (!value) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

function cleanText(value, max = 1000) {
  if (value == null) return null;
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max);
}

function enumValue(value, allowed, fallback) {
  const normalized = String(value || '').toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}
