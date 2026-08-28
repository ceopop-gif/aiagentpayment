import { admin, secretStore, requireUser, sendJson, handleError } from './_shared.js';
import { getOmniConversation, listOmniInbox, sendOmniText } from '../../server/channels/service.js';

export default async function handler(req, res) {
  try {
    const user = await requireUser(req);
    if (req.method === 'GET') {
      const merchantId = String(req.query?.merchantId || '');
      if (!merchantId) return sendJson(res, 400, { error: 'merchantId is required' });
      const conversationId = String(req.query?.conversationId || '');
      if (conversationId) {
        return sendJson(res, 200, await getOmniConversation({ admin, merchantId, userId: user.id, conversationId, limit: req.query?.limit }));
      }
      return sendJson(res, 200, { conversations: await listOmniInbox({ admin, merchantId, userId: user.id, limit: req.query?.limit }) });
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      if (!body.merchantId || !body.conversationId || !body.text) return sendJson(res, 400, { error: 'merchantId, conversationId and text are required' });
      const result = await sendOmniText({ admin, secretStore, merchantId: body.merchantId, userId: user.id, conversationId: body.conversationId, text: body.text, senderType: 'STAFF' });
      return sendJson(res, 201, result);
    }
    return sendJson(res, 405, { error: 'method_not_allowed' });
  } catch (error) { handleError(res, error); }
}
