import { admin, secretStore, rawBody, sendJson, handleError } from './_shared.js';
import { processMessagingWebhook } from '../../server/channels/service.js';
import { createAiProviderFromEnv } from '../../server/ai/http-provider.js';
import { createOmnichannelSalesReply } from '../../server/channels/ai-sales-agent.js';

const aiProvider = createAiProviderFromEnv();

export default async function handler(req, res) {
  try {
    const provider = String(req.query?.provider || '').toUpperCase();
    const channelId = String(req.query?.channelId || '');
    if (!provider || !channelId) return sendJson(res, 400, { error: 'provider and channelId are required' });
    const raw = req.method === 'POST' ? await rawBody(req) : '';
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query || {})) {
      if (Array.isArray(v)) v.forEach(x => query.append(k, String(x)));
      else if (v != null) query.set(k, String(v));
    }
    const result = await processMessagingWebhook({
      admin,
      secretStore,
      provider,
      channelId,
      method: req.method,
      query,
      headers: req.headers,
      rawBody: raw,
      generateAiReply: aiProvider ? args => createOmnichannelSalesReply({ admin, aiProvider, ...args }) : null
    });
    res.statusCode = result.status;
    if (result.contentType) res.setHeader('content-type', `${result.contentType}; charset=utf-8`);
    else res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(result.contentType ? String(result.body ?? '') : JSON.stringify(result.body ?? {}));
  } catch (error) {
    handleError(res, error);
  }
}
