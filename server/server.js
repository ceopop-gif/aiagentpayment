import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { getAdminClient } from './lib/supabase-admin.js';
import { createDatabaseSecretStore } from './secrets/secret-store.js';
import { createAiProviderFromEnv } from './ai/http-provider.js';
import { executeAiCommand } from './ai/router.js';
import { getPaymentProviders } from './payment/provider-registry.js';
import { processInboundPaymentWebhook } from './webhooks/inbound.js';
import { dispatchOutboundEvent } from './webhooks/outbound.js';
import { registerWebhook } from './services/webhook-service.js';
import { runAutomationsForEvent } from './automation/runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const port = Number(process.env.PORT || 3000);

const admin = getAdminClient();
const secretStore = createDatabaseSecretStore(admin);
const aiProvider = createAiProviderFromEnv();

const dispatchOutbound = event => dispatchOutboundEvent({ admin, event, secretStore });
const runAutomations = event => runAutomationsForEvent({ admin, event, handlers: {
  WEBHOOK_OUT: async () => ({ handled_by: 'event_bus_webhook_dispatch' })
}});

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        service: 'annypay-ai-commerce',
        database: true,
        ai: Boolean(aiProvider),
        paymentProviders: Object.keys(getPaymentProviders())
      });
    }

    if (url.pathname === '/api/ai/command' && req.method === 'POST') {
      const user = await authenticate(req);
      const body = await readJson(req);
      if (!body.merchantId || !body.prompt) return json(res, 400, { error: 'merchantId and prompt are required' });
      const result = await executeAiCommand({
        admin,
        aiProvider,
        merchantId: body.merchantId,
        userId: user.id,
        prompt: body.prompt,
        context: body.context || {},
        adapters: getPaymentProviders(),
        dispatchOutbound,
        runAutomations,
        confirmationToken: body.confirmationToken || null
      });
      return json(res, 200, result);
    }

    if (url.pathname === '/api/webhooks/out' && req.method === 'POST') {
      const user = await authenticate(req);
      const body = await readJson(req);
      const result = await registerWebhook({
        admin,
        merchantId: body.merchantId,
        userId: user.id,
        input: { name: body.name, url: body.url, events: body.events },
        secretStore
      });
      return json(res, 201, {
        endpoint: result.endpoint,
        signingSecret: result.signingSecret,
        warning: 'Store this signing secret now. It should not be displayed again.'
      });
    }

    if (url.pathname.startsWith('/api/webhooks/in/') && req.method === 'POST') {
      const provider = decodeURIComponent(url.pathname.split('/').pop());
      const rawBody = await readRaw(req, 1024 * 1024);
      const result = await processInboundPaymentWebhook({
        admin,
        provider,
        rawBody,
        headers: req.headers,
        adapters: getPaymentProviders(),
        dispatchOutbound,
        runAutomations
      });
      return json(res, result.status, result.body);
    }

    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'API route not found' });
    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    const status = /Unauthorized/.test(error.message) ? 401 : /Forbidden/.test(error.message) ? 403 : 500;
    return json(res, status, { error: status === 500 ? 'internal_error' : error.message, message: status === 500 ? error.message : undefined });
  }
});

server.listen(port, () => {
  console.log(`AnnyPay running on http://localhost:${port}`);
  console.log(`AI Gateway: ${aiProvider ? 'configured' : 'not configured'}`);
  console.log(`Payment Providers: ${Object.keys(getPaymentProviders()).join(', ') || 'none'}`);
});

async function authenticate(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) throw new Error('Unauthorized');
  const token = auth.slice(7);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new Error('Unauthorized');
  return data.user;
}

async function readJson(req) {
  const raw = await readRaw(req, 256 * 1024);
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new Error('Invalid JSON body'); }
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let total = 0; const chunks = [];
    req.on('data', chunk => {
      total += chunk.length;
      if (total > limit) { reject(new Error('Request body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(pathname, res) {
  let path = pathname === '/' ? '/index.html' : pathname;
  path = normalize(path).replace(/^(\.\.(\/|\\|$))+/, '');
  const file = join(root, path.replace(/^\//, ''));
  if (!file.startsWith(root)) return text(res, 403, 'Forbidden');
  try {
    const info = await stat(file);
    if (!info.isFile()) return text(res, 404, 'Not Found');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': mime(file), 'cache-control': extname(file)==='.html'?'no-cache':'public, max-age=300' });
    res.end(data);
  } catch { return text(res, 404, 'Not Found'); }
}

function mime(file) {
  return ({'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extname(file).toLowerCase()] || 'application/octet-stream');
}
function json(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data))}
function text(res,status,data){res.writeHead(status,{'content-type':'text/plain; charset=utf-8'});res.end(data)}
