import { getAdminClient } from '../../server/lib/supabase-admin.js';
import { createDatabaseSecretStore } from '../../server/secrets/secret-store.js';

export const admin = getAdminClient();
export const secretStore = createDatabaseSecretStore(admin);

export async function requireUser(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) throw httpError(401, 'Unauthorized');
  const { data, error } = await admin.auth.getUser(auth.slice(7));
  if (error || !data?.user) throw httpError(401, 'Unauthorized');
  return data.user;
}

export async function rawBody(req, limit = 1024 * 1024) {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > limit) {
        reject(httpError(413, 'Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function handleError(res, error) {
  const status = error.status || (/Unauthorized/.test(error.message) ? 401 : /Forbidden/.test(error.message) ? 403 : 500);
  sendJson(res, status, { error: status === 500 ? 'internal_error' : error.message, message: error.message });
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
