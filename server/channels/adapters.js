import crypto from 'node:crypto';

const text = value => typeof value === 'string' ? value : '';
const json = raw => {
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Invalid channel webhook JSON'); }
};

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function verifyHmac({ rawBody, secret, received, encoding = 'hex', prefix = '' }) {
  if (!secret || !received) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest(encoding);
  return safeEqual(prefix + expected, received);
}

const LINE = {
  async verify({ method, rawBody, headers, secrets }) {
    if (method !== 'POST') return { ok: false, status: 405, body: { error: 'method_not_allowed' } };
    const received = headers['x-line-signature'];
    if (!secrets.channelSecret || !received) return { ok: false, status: 401, body: { error: 'line_signature_missing' } };
    const expected = crypto.createHmac('sha256', secrets.channelSecret).update(rawBody).digest('base64');
    return safeEqual(expected, received)
      ? { ok: true }
      : { ok: false, status: 401, body: { error: 'invalid_line_signature' } };
  },
  parse(rawBody) {
    const body = json(rawBody);
    return (body.events || []).map(e => ({
      eventId: e.webhookEventId || e.message?.id || null,
      externalUserId: e.source?.userId || e.source?.groupId || e.source?.roomId || null,
      messageId: e.message?.id || e.webhookEventId || null,
      type: e.message?.type ? String(e.message.type).toUpperCase() : String(e.type || 'OTHER').toUpperCase(),
      text: e.message?.type === 'text' ? text(e.message.text) : '',
      timestamp: e.timestamp ? new Date(e.timestamp).toISOString() : new Date().toISOString(),
      replyToken: e.replyToken || null,
      raw: e
    })).filter(e => e.externalUserId);
  },
  async sendText({ channel, externalUserId, text: bodyText, secrets, replyContext }) {
    if (!secrets.accessToken) throw new Error('LINE access token is not configured');
    const useReply = Boolean(replyContext?.replyToken);
    const url = useReply
      ? 'https://api.line.me/v2/bot/message/reply'
      : 'https://api.line.me/v2/bot/message/push';
    const payload = useReply
      ? { replyToken: replyContext.replyToken, messages: [{ type: 'text', text: bodyText }] }
      : { to: externalUserId, messages: [{ type: 'text', text: bodyText }] };
    return requestJson(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${secrets.accessToken}` },
      body: payload
    });
  }
};

function verifyMetaWebhook({ method, rawBody, headers, query, secrets }) {
  if (method === 'GET') {
    const mode = query.get('hub.mode');
    const token = query.get('hub.verify_token');
    const challenge = query.get('hub.challenge');
    if (mode === 'subscribe' && secrets.verifyToken && safeEqual(token, secrets.verifyToken)) {
      return { ok: true, challenge: challenge || '' };
    }
    return { ok: false, status: 403, body: { error: 'meta_webhook_verification_failed' } };
  }
  if (method !== 'POST') return { ok: false, status: 405, body: { error: 'method_not_allowed' } };
  const signature = headers['x-hub-signature-256'];
  if (!secrets.appSecret || !signature) return { ok: false, status: 401, body: { error: 'meta_signature_missing' } };
  return verifyHmac({ rawBody, secret: secrets.appSecret, received: signature, prefix: 'sha256=' })
    ? { ok: true }
    : { ok: false, status: 401, body: { error: 'invalid_meta_signature' } };
}

function parseMetaMessaging(rawBody) {
  const body = json(rawBody);
  const events = [];
  for (const entry of body.entry || []) {
    for (const m of entry.messaging || []) {
      if (!m.sender?.id) continue;
      events.push({
        eventId: m.message?.mid || `${entry.id || 'meta'}:${m.timestamp || Date.now()}`,
        externalUserId: m.sender.id,
        messageId: m.message?.mid || null,
        type: m.message?.text ? 'TEXT' : m.message?.attachments?.length ? 'OTHER' : m.postback ? 'POSTBACK' : 'OTHER',
        text: m.message?.text || m.postback?.title || m.postback?.payload || '',
        timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
        raw: m
      });
    }
  }
  return events;
}

const FACEBOOK = {
  verify: verifyMetaWebhook,
  parse: parseMetaMessaging,
  async sendText({ channel, externalUserId, text: bodyText, secrets }) {
    if (!secrets.accessToken) throw new Error('Facebook Page access token is not configured');
    const version = channel.public_config?.graph_api_version || process.env.META_GRAPH_VERSION;
    if (!version) throw new Error('META_GRAPH_VERSION or graph_api_version is required');
    const endpoint = `https://graph.facebook.com/${encodeURIComponent(version)}/me/messages?access_token=${encodeURIComponent(secrets.accessToken)}`;
    return requestJson(endpoint, {
      method: 'POST',
      body: { recipient: { id: externalUserId }, messaging_type: 'RESPONSE', message: { text: bodyText } }
    });
  }
};

const INSTAGRAM = {
  verify: verifyMetaWebhook,
  parse: parseMetaMessaging,
  async sendText({ channel, externalUserId, text: bodyText, secrets }) {
    if (!secrets.accessToken) throw new Error('Instagram access token is not configured');
    const version = channel.public_config?.graph_api_version || process.env.META_GRAPH_VERSION;
    const accountId = channel.external_account_id;
    if (!version || !accountId) throw new Error('Instagram graph_api_version and account id are required');
    const endpoint = `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(accountId)}/messages`;
    return requestJson(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${secrets.accessToken}` },
      body: { recipient: { id: externalUserId }, message: { text: bodyText } }
    });
  }
};

const WHATSAPP = {
  verify: verifyMetaWebhook,
  parse(rawBody) {
    const body = json(rawBody);
    const events = [];
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        for (const m of value.messages || []) {
          const content = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
          events.push({
            eventId: m.id || null,
            externalUserId: m.from || null,
            messageId: m.id || null,
            type: String(m.type || 'OTHER').toUpperCase(),
            text: content,
            timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
            raw: { ...m, contacts: value.contacts || [] }
          });
        }
      }
    }
    return events.filter(e => e.externalUserId);
  },
  async sendText({ channel, externalUserId, text: bodyText, secrets }) {
    if (!secrets.accessToken) throw new Error('WhatsApp access token is not configured');
    const version = channel.public_config?.graph_api_version || process.env.META_GRAPH_VERSION;
    const phoneNumberId = channel.external_account_id;
    if (!version || !phoneNumberId) throw new Error('WhatsApp graph_api_version and phone number id are required');
    const endpoint = `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`;
    return requestJson(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${secrets.accessToken}` },
      body: { messaging_product: 'whatsapp', to: externalUserId, type: 'text', text: { body: bodyText } }
    });
  }
};

const TELEGRAM = {
  async verify({ method, headers, secrets }) {
    if (method !== 'POST') return { ok: false, status: 405, body: { error: 'method_not_allowed' } };
    if (secrets.verifyToken) {
      const got = headers['x-telegram-bot-api-secret-token'];
      if (!safeEqual(got, secrets.verifyToken)) return { ok: false, status: 401, body: { error: 'invalid_telegram_secret_token' } };
    }
    return { ok: true };
  },
  parse(rawBody) {
    const update = json(rawBody);
    const m = update.message || update.edited_message || update.callback_query?.message;
    const from = update.message?.from || update.edited_message?.from || update.callback_query?.from;
    if (!m || !from?.id) return [];
    return [{
      eventId: String(update.update_id || m.message_id || Date.now()),
      externalUserId: String(from.id),
      messageId: String(m.message_id || update.update_id || ''),
      type: m.text ? 'TEXT' : m.photo ? 'IMAGE' : m.video ? 'VIDEO' : m.document ? 'FILE' : 'OTHER',
      text: m.text || update.callback_query?.data || '',
      timestamp: m.date ? new Date(Number(m.date) * 1000).toISOString() : new Date().toISOString(),
      raw: update
    }];
  },
  async sendText({ externalUserId, text: bodyText, secrets }) {
    if (!secrets.accessToken) throw new Error('Telegram bot token is not configured');
    const endpoint = `https://api.telegram.org/bot${encodeURIComponent(secrets.accessToken)}/sendMessage`;
    return requestJson(endpoint, { method: 'POST', body: { chat_id: externalUserId, text: bodyText } });
  }
};

const WEBCHAT = {
  async verify() { return { ok: true }; },
  parse(rawBody) {
    const body = json(rawBody);
    if (!body.visitorId) return [];
    return [{
      eventId: body.messageId || crypto.randomUUID(),
      externalUserId: String(body.visitorId),
      messageId: body.messageId || null,
      type: body.type || 'TEXT',
      text: text(body.text),
      timestamp: body.timestamp || new Date().toISOString(),
      raw: body
    }];
  },
  async sendText({ externalUserId, text: bodyText }) {
    return { ok: true, provider: 'WEBCHAT', visitorId: externalUserId, text: bodyText, queued: true };
  }
};

const adapters = { LINE, FACEBOOK, INSTAGRAM, WHATSAPP, TELEGRAM, WEBCHAT };

export function getChannelAdapter(provider) {
  const key = String(provider || '').toUpperCase();
  const adapter = adapters[key];
  if (!adapter) throw new Error(`Unsupported messaging provider: ${provider}`);
  return adapter;
}

export function listChannelProviders() {
  return Object.keys(adapters);
}

async function requestJson(url, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const raw = await response.text();
  let parsed;
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; }
  if (!response.ok) {
    const error = new Error(parsed?.error?.message || parsed?.description || `Channel API HTTP ${response.status}`);
    error.status = response.status;
    error.providerBody = parsed;
    throw error;
  }
  return parsed;
}
