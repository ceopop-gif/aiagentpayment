import crypto from 'node:crypto';
import { requireMerchantMember } from '../lib/supabase-admin.js';
import { getChannelAdapter, listChannelProviders } from './adapters.js';

const SAFE_CHANNEL_FIELDS = 'id,merchant_id,store_id,provider,external_account_id,display_name,status,ai_mode,public_config,created_at,updated_at';

export { listChannelProviders };

export async function listMessagingChannels({ admin, merchantId, userId }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER','ADMIN','STAFF','VIEWER']);
  const { data, error } = await admin.from('messaging_channels')
    .select(SAFE_CHANNEL_FIELDS)
    .eq('merchant_id', merchantId)
    .order('created_at');
  if (error) throw error;
  return data || [];
}

export async function connectMessagingChannel({ admin, secretStore, merchantId, userId, input }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER','ADMIN']);
  const provider = String(input?.provider || '').toUpperCase();
  if (!listChannelProviders().includes(provider)) throw new Error(`Unsupported messaging provider: ${provider}`);
  if (!input?.externalAccountId) throw new Error('externalAccountId is required');

  const { data: existing, error: existingError } = await admin.from('messaging_channels')
    .select('id').eq('merchant_id', merchantId).eq('provider', provider)
    .eq('external_account_id', String(input.externalAccountId)).maybeSingle();
  if (existingError) throw existingError;
  const id = existing?.id || crypto.randomUUID();
  const secretIds = {
    access: `channel:${id}:access-token`,
    app: `channel:${id}:app-secret`,
    verify: `channel:${id}:verify-token`,
    channel: `channel:${id}:channel-secret`
  };

  if (input.accessToken) await secretStore.put(secretIds.access, input.accessToken, { merchantId, purpose: 'messaging_access_token' });
  if (input.appSecret) await secretStore.put(secretIds.app, input.appSecret, { merchantId, purpose: 'messaging_app_secret' });
  if (input.verifyToken) await secretStore.put(secretIds.verify, input.verifyToken, { merchantId, purpose: 'messaging_verify_token' });
  if (input.channelSecret) await secretStore.put(secretIds.channel, input.channelSecret, { merchantId, purpose: 'messaging_channel_secret' });

  const record = {
    id,
    merchant_id: merchantId,
    store_id: input.storeId || null,
    provider,
    external_account_id: String(input.externalAccountId),
    display_name: input.displayName || provider,
    status: input.status || 'ACTIVE',
    ai_mode: input.aiMode || 'DRAFT',
    public_config: sanitizePublicConfig(input.publicConfig || {}),
    access_token_secret_id: input.accessToken || existing ? secretIds.access : null,
    app_secret_secret_id: input.appSecret || existing ? secretIds.app : null,
    verify_token_secret_id: input.verifyToken || existing ? secretIds.verify : null,
    channel_secret_secret_id: input.channelSecret || existing ? secretIds.channel : null,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await admin.from('messaging_channels').upsert(record).select(SAFE_CHANNEL_FIELDS).single();
  if (error) throw error;
  return {
    channel: data,
    webhook_path: `/api/channels/webhook/${provider.toLowerCase()}/${id}`,
    provider_requirements: providerRequirements(provider)
  };
}

export async function updateChannelAiMode({ admin, merchantId, userId, channelId, aiMode }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER','ADMIN','STAFF']);
  if (!['OFF','DRAFT','AUTO'].includes(aiMode)) throw new Error('aiMode must be OFF, DRAFT or AUTO');
  const { data, error } = await admin.from('messaging_channels')
    .update({ ai_mode: aiMode, updated_at: new Date().toISOString() })
    .eq('id', channelId).eq('merchant_id', merchantId).select(SAFE_CHANNEL_FIELDS).single();
  if (error) throw error;
  return data;
}

export async function listOmniInbox({ admin, merchantId, userId, limit = 50 }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER','ADMIN','STAFF','VIEWER']);
  const { data, error } = await admin.from('omni_conversations')
    .select('id,store_id,channel_id,contact_id,status,ai_mode,sales_stage,assigned_user_id,last_message_at,context,messaging_channels(provider,display_name),omni_contacts(display_name,phone,email)')
    .eq('merchant_id', merchantId)
    .order('last_message_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, Number(limit || 50))));
  if (error) throw error;
  return data || [];
}

export async function getOmniConversation({ admin, merchantId, userId, conversationId, limit = 100 }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER','ADMIN','STAFF','VIEWER']);
  const { data: conversation, error } = await admin.from('omni_conversations')
    .select('*,messaging_channels(provider,display_name,external_account_id),omni_contacts(display_name,phone,email)')
    .eq('id', conversationId).eq('merchant_id', merchantId).single();
  if (error) throw error;
  const { data: messages, error: me } = await admin.from('omni_messages')
    .select('id,direction,sender_type,message_type,text_content,media,ai_generated,delivery_status,created_at')
    .eq('conversation_id', conversationId).eq('merchant_id', merchantId)
    .order('created_at').limit(Math.min(500, Math.max(1, Number(limit || 100))));
  if (me) throw me;
  return { conversation, messages: messages || [] };
}

export async function sendOmniText({ admin, secretStore, merchantId, userId, conversationId, text, senderType = 'STAFF' }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER','ADMIN','STAFF']);
  if (!String(text || '').trim()) throw new Error('text is required');
  const ctx = await loadConversationContext(admin, merchantId, conversationId);
  const secrets = await loadChannelSecrets(secretStore, ctx.channel);
  const adapter = getChannelAdapter(ctx.channel.provider);
  const result = await adapter.sendText({
    channel: ctx.channel,
    externalUserId: ctx.identity.external_user_id,
    text: String(text).trim(),
    secrets,
    replyContext: null
  });
  const providerMessageId = findProviderMessageId(result);
  const { data: msg, error } = await admin.from('omni_messages').insert({
    merchant_id: merchantId,
    conversation_id: conversationId,
    channel_id: ctx.channel.id,
    provider_message_id: providerMessageId,
    direction: 'OUT',
    sender_type: senderType,
    message_type: 'TEXT',
    text_content: String(text).trim(),
    ai_generated: senderType === 'AI',
    delivery_status: 'SENT',
    payload: sanitizeProviderPayload(result)
  }).select('*').single();
  if (error) throw error;
  return { message: msg, provider: result };
}

export async function processMessagingWebhook({ admin, secretStore, provider, channelId, method, query, headers, rawBody, generateAiReply = null }) {
  const p = String(provider || '').toUpperCase();
  const { data: channel, error } = await admin.from('messaging_channels')
    .select('*').eq('id', channelId).eq('provider', p).maybeSingle();
  if (error) throw error;
  if (!channel || !['ACTIVE','PAUSED'].includes(channel.status)) return { status: 404, body: { error: 'channel_not_found' } };

  const adapter = getChannelAdapter(p);
  const secrets = await loadChannelSecrets(secretStore, channel);
  const verified = await adapter.verify({ method, rawBody, headers, query, secrets, channel });
  if (!verified.ok) return { status: verified.status || 401, body: verified.body || { error: 'verification_failed' } };
  if (method === 'GET' && Object.prototype.hasOwnProperty.call(verified, 'challenge')) {
    return { status: 200, body: verified.challenge, contentType: 'text/plain' };
  }

  const events = adapter.parse(rawBody);
  const accepted = [];
  for (const event of events) {
    const result = await recordInboundEvent({ admin, channel, event });
    if (!result?.message) continue;
    accepted.push(result.message.id);

    if (channel.status === 'ACTIVE' && channel.ai_mode === 'AUTO' && generateAiReply && event.text) {
      const ai = await generateAiReply({
        merchantId: channel.merchant_id,
        storeId: channel.store_id,
        conversationId: result.conversation.id,
        customerText: event.text,
        provider: p
      });
      if (ai?.text) {
        const providerResult = await adapter.sendText({
          channel,
          externalUserId: event.externalUserId,
          text: ai.text,
          secrets,
          replyContext: { replyToken: event.replyToken || null }
        });
        await admin.from('omni_messages').insert({
          merchant_id: channel.merchant_id,
          conversation_id: result.conversation.id,
          channel_id: channel.id,
          provider_message_id: findProviderMessageId(providerResult),
          direction: 'OUT',
          sender_type: 'AI',
          message_type: 'TEXT',
          text_content: ai.text,
          ai_generated: true,
          delivery_status: 'SENT',
          payload: sanitizeProviderPayload(providerResult)
        });
      }
    }
  }
  return { status: 200, body: { ok: true, accepted: accepted.length } };
}

async function recordInboundEvent({ admin, channel, event }) {
  if (!event.externalUserId) return null;
  const identity = await findOrCreateIdentity({ admin, channel, event });
  const conversation = await findOrCreateConversation({ admin, channel, identity });
  const messageRecord = {
    merchant_id: channel.merchant_id,
    conversation_id: conversation.id,
    channel_id: channel.id,
    provider_message_id: event.messageId || event.eventId || crypto.randomUUID(),
    direction: 'IN',
    sender_type: 'CUSTOMER',
    message_type: normalizeMessageType(event.type),
    text_content: event.text || null,
    payload: sanitizeInboundPayload(event.raw || {}),
    ai_generated: false,
    delivery_status: 'RECEIVED',
    created_at: event.timestamp || new Date().toISOString()
  };
  const { data: message, error } = await admin.from('omni_messages')
    .upsert(messageRecord, { onConflict: 'channel_id,provider_message_id', ignoreDuplicates: true })
    .select('*').maybeSingle();
  if (error) throw error;
  await admin.from('omni_contact_identities').update({ last_seen_at: new Date().toISOString() }).eq('id', identity.id);
  return { identity, conversation, message };
}

async function findOrCreateIdentity({ admin, channel, event }) {
  const { data: existing, error } = await admin.from('omni_contact_identities')
    .select('*').eq('channel_id', channel.id).eq('external_user_id', String(event.externalUserId)).maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const displayName = extractDisplayName(event.raw) || null;
  const { data: contact, error: ce } = await admin.from('omni_contacts').insert({
    merchant_id: channel.merchant_id,
    display_name: displayName,
    metadata: { first_channel: channel.provider }
  }).select('*').single();
  if (ce) throw ce;
  const { data: identity, error: ie } = await admin.from('omni_contact_identities').insert({
    merchant_id: channel.merchant_id,
    contact_id: contact.id,
    channel_id: channel.id,
    provider: channel.provider,
    external_user_id: String(event.externalUserId),
    profile: displayName ? { display_name: displayName } : {},
    last_seen_at: new Date().toISOString()
  }).select('*').single();
  if (ie) throw ie;
  return identity;
}

async function findOrCreateConversation({ admin, channel, identity }) {
  const { data: existing, error } = await admin.from('omni_conversations')
    .select('*').eq('channel_id', channel.id).eq('identity_id', identity.id).maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const { data, error: insertError } = await admin.from('omni_conversations').insert({
    merchant_id: channel.merchant_id,
    store_id: channel.store_id,
    channel_id: channel.id,
    contact_id: identity.contact_id,
    identity_id: identity.id,
    ai_mode: channel.ai_mode,
    status: 'OPEN',
    sales_stage: 'NEW'
  }).select('*').single();
  if (insertError) throw insertError;
  return data;
}

async function loadConversationContext(admin, merchantId, conversationId) {
  const { data: conversation, error } = await admin.from('omni_conversations')
    .select('*').eq('id', conversationId).eq('merchant_id', merchantId).single();
  if (error) throw error;
  const [{ data: channel, error: ce }, { data: identity, error: ie }] = await Promise.all([
    admin.from('messaging_channels').select('*').eq('id', conversation.channel_id).single(),
    admin.from('omni_contact_identities').select('*').eq('id', conversation.identity_id).single()
  ]);
  if (ce) throw ce; if (ie) throw ie;
  return { conversation, channel, identity };
}

async function loadChannelSecrets(secretStore, channel) {
  const [accessToken, appSecret, verifyToken, channelSecret] = await Promise.all([
    secretStore.get(channel.access_token_secret_id),
    secretStore.get(channel.app_secret_secret_id),
    secretStore.get(channel.verify_token_secret_id),
    secretStore.get(channel.channel_secret_secret_id)
  ]);
  return { accessToken, appSecret, verifyToken, channelSecret };
}

function sanitizePublicConfig(config) {
  const blocked = /secret|token|password|private|key/i;
  return Object.fromEntries(Object.entries(config || {}).filter(([key]) => !blocked.test(key)));
}

function sanitizeProviderPayload(value) {
  if (!value || typeof value !== 'object') return {};
  const clone = JSON.parse(JSON.stringify(value));
  for (const key of Object.keys(clone)) if (/token|secret|password|authorization/i.test(key)) delete clone[key];
  return clone;
}

function sanitizeInboundPayload(value) {
  const raw = sanitizeProviderPayload(value);
  return JSON.parse(JSON.stringify(raw, (key, val) => /token|secret|authorization/i.test(key) ? undefined : val));
}

function normalizeMessageType(type) {
  const t = String(type || 'OTHER').toUpperCase();
  return ['TEXT','IMAGE','VIDEO','AUDIO','FILE','LOCATION','STICKER','POSTBACK'].includes(t) ? t : 'OTHER';
}

function extractDisplayName(raw) {
  return raw?.contacts?.[0]?.profile?.name || raw?.from?.first_name || raw?.from?.username || null;
}

function findProviderMessageId(result) {
  return result?.message_id || result?.messages?.[0]?.id || result?.recipient_id || result?.result?.message_id || null;
}

function providerRequirements(provider) {
  const requirements = {
    LINE: ['channel access token','channel secret','webhook URL'],
    FACEBOOK: ['Page access token','Meta app secret','verify token','webhook subscription'],
    INSTAGRAM: ['Instagram professional account','Meta access token','Meta app secret','verify token','webhook subscription'],
    WHATSAPP: ['WhatsApp Business account','phone number id','access token','Meta app secret','verify token'],
    TELEGRAM: ['bot token','webhook secret token (recommended)'],
    WEBCHAT: ['AnyPay web chat widget']
  };
  return requirements[provider] || [];
}
