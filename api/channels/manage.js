import { admin, secretStore, requireUser, sendJson, handleError } from './_shared.js';
import { connectMessagingChannel, listMessagingChannels, listChannelProviders, updateChannelAiMode } from '../../server/channels/service.js';

export default async function handler(req, res) {
  try {
    const user = await requireUser(req);
    if (req.method === 'GET') {
      const merchantId = String(req.query?.merchantId || '');
      if (!merchantId) return sendJson(res, 400, { error: 'merchantId is required' });
      return sendJson(res, 200, { providers: listChannelProviders(), channels: await listMessagingChannels({ admin, merchantId, userId: user.id }) });
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      if (!body.merchantId) return sendJson(res, 400, { error: 'merchantId is required' });
      const result = await connectMessagingChannel({ admin, secretStore, merchantId: body.merchantId, userId: user.id, input: body });
      return sendJson(res, 201, result);
    }
    if (req.method === 'PATCH') {
      const body = req.body || {};
      if (!body.merchantId || !body.channelId || !body.aiMode) return sendJson(res, 400, { error: 'merchantId, channelId and aiMode are required' });
      return sendJson(res, 200, { channel: await updateChannelAiMode({ admin, merchantId: body.merchantId, userId: user.id, channelId: body.channelId, aiMode: body.aiMode }) });
    }
    return sendJson(res, 405, { error: 'method_not_allowed' });
  } catch (error) { handleError(res, error); }
}
