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
import { processInboundPayoutWebhook } from './webhooks/payout-inbound.js';
import { dispatchOutboundEvent } from './webhooks/outbound.js';

import { registerWebhook } from './services/webhook-service.js';
import { runAutomationsForEvent } from './automation/runner.js';
import { getStoreBilling, createTokenPurchaseOrder } from './services/billing-service.js';
import { startStoreSubscription } from './services/subscription-service.js';
import { getStoreBalance } from './services/balance-service.js';
import {
  listPayoutAccounts,
  registerPayoutAccount,
  verifyPayoutAccount,
  setDefaultPayoutAccount,
  requestWithdrawal,
  submitWithdrawalToProvider,
  listWithdrawals
} from './services/payout-service.js';

import { configurePayoutProvidersFromEnv } from './payout/configure.js';
import { getPayoutProviders, listPayoutProviderNames } from './payout/provider-registry.js';

import {
  enrichRequestAudit,
  markRequestError,
  setRequestActor,
  setRequestProviderActor,
  startRequestAudit
} from './logging/audit-logger.js';
import {
  listActivityLogs,
  listUserSessions,
  recordAuthActivity,
  recordClientActivity
} from './services/activity-service.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const port = Number(process.env.PORT || 3000);

const admin = getAdminClient();
const secretStore = createDatabaseSecretStore(admin);
const aiProvider = createAiProviderFromEnv();
configurePayoutProvidersFromEnv();

const dispatchOutbound = event => dispatchOutboundEvent({ admin, event, secretStore });
const runAutomations = event => runAutomationsForEvent({
  admin,
  event,
  handlers: {
    WEBHOOK_OUT: async () => ({ handled_by: 'event_bus_webhook_dispatch' })
  }
});

const server = createServer(async (req, res) => {
  startRequestAudit({ admin, req, res });

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    enrichRequestAudit(req, {
      merchantId: url.searchParams.get('merchantId'),
      storeId: url.searchParams.get('storeId')
    });

    if (url.pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        service: 'annypay-ai-commerce',
        database: true,
        auditLogging: true,
        ai: Boolean(aiProvider),
        billing: true,
        payouts: true,
        paymentProviders: Object.keys(getPaymentProviders()),
        payoutProviders: listPayoutProviderNames()
      });
    }

    // Unified client/auth/activity logs
    if (url.pathname === '/api/logs/client' && req.method === 'POST') {
      const user = await authenticateOptional(req);
      const body = await readJson(req);
      const result = await recordClientActivity({ admin, user, body, req });
      return json(res, 202, result);
    }

    if (url.pathname === '/api/logs/auth' && req.method === 'POST') {
      const user = await authenticateOptional(req);
      const body = await readJson(req);
      const result = await recordAuthActivity({ admin, user, body, req });
      return json(res, 202, result);
    }

    if (url.pathname === '/api/logs' && req.method === 'GET') {
      const user = await authenticate(req);
      const merchantId = url.searchParams.get('merchantId');
      if (!merchantId) return json(res, 400, { error: 'merchantId is required' });

      const logs = await listActivityLogs({
        admin,
        merchantId,
        userId: user.id,
        filters: {
          storeId: url.searchParams.get('storeId'),
          actorUserId: url.searchParams.get('actorUserId'),
          sourceArea: url.searchParams.get('sourceArea'),
          severity: url.searchParams.get('severity'),
          eventName: url.searchParams.get('eventName'),
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
          limit: url.searchParams.get('limit')
        }
      });
      return json(res, 200, { logs });
    }

    if (url.pathname === '/api/sessions' && req.method === 'GET') {
      const user = await authenticate(req);
      const merchantId = url.searchParams.get('merchantId');
      if (!merchantId) return json(res, 400, { error: 'merchantId is required' });

      const sessions = await listUserSessions({
        admin,
        merchantId,
        userId: user.id,
        filters: {
          storeId: url.searchParams.get('storeId'),
          actorUserId: url.searchParams.get('actorUserId'),
          status: url.searchParams.get('status'),
          limit: url.searchParams.get('limit')
        }
      });
      return json(res, 200, { sessions });
    }

    // Anny AI
    if (url.pathname === '/api/ai/command' && req.method === 'POST') {
      const user = await authenticate(req);
      const body = await readJson(req);
      if (!body.merchantId || !body.prompt) {
        return json(res, 400, { error: 'merchantId and prompt are required' });
      }

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

    // Membership and AI Tokens
    if (url.pathname.startsWith('/api/billing/store/') && req.method === 'GET') {
      const user = await authenticate(req);
      const storeId = decodeURIComponent(url.pathname.split('/').pop());
      const merchantId = url.searchParams.get('merchantId');
      if (!merchantId || !storeId) {
        return json(res, 400, { error: 'merchantId and storeId are required' });
      }

      return json(res, 200, await getStoreBilling({
        admin,
        merchantId,
        userId: user.id,
        storeId
      }));
    }

    if (url.pathname === '/api/billing/subscription' && req.method === 'POST') {
      const user = await authenticate(req);
      const body = await readJson(req);
      if (!body.merchantId || !body.storeId || !body.planId) {
        return json(res, 400, { error: 'merchantId, storeId and planId are required' });
      }

      const result = await startStoreSubscription({
        admin,
        merchantId: body.merchantId,
        userId: user.id,
        storeId: body.storeId,
        planId: body.planId,
        billingProvider: body.billingProvider || process.env.BILLING_PROVIDER || null
      });
      return json(res, 201, result);
    }

    if (url.pathname === '/api/billing/token-purchase' && req.method === 'POST') {
      const user = await authenticate(req);
      const body = await readJson(req);
      if (!body.merchantId || !body.storeId || !body.packId) {
        return json(res, 400, { error: 'merchantId, storeId and packId are required' });
      }

      const result = await createTokenPurchaseOrder({
        admin,
        merchantId: body.merchantId,
        userId: user.id,
        storeId: body.storeId,
        packId: body.packId,
        quantity: Number(body.quantity || 1),
        billingProvider: body.billingProvider || process.env.BILLING_PROVIDER || null
      });
      return json(res, 201, {
        purchase: result,
        next_step: 'CREATE_VERIFIED_BILLING_PAYMENT',
        warning: 'Tokens are granted only after verified payment.'
      });
    }

    // Store balance, payout accounts and withdrawals
    if (url.pathname === '/api/payout/balance' && req.method === 'GET') {
      const user = await authenticate(req);
      const merchantId = url.searchParams.get('merchantId');
      const storeId = url.searchParams.get('storeId');
      if (!merchantId || !storeId) {
        return json(res, 400, { error: 'merchantId and storeId are required' });
      }

      return json(res, 200, await getStoreBalance({
        admin,
        merchantId,
        userId: user.id,
        storeId,
        ledgerLimit: url.searchParams.get('limit') || 50
      }));
    }

    if (url.pathname === '/api/payout/accounts' && req.method === 'GET') {
      const user = await authenticate(req);
      const merchantId = url.searchParams.get('merchantId');
      const storeId = url.searchParams.get('storeId');
      if (!merchantId || !storeId) {
        return json(res, 400, { error: 'merchantId and storeId are required' });
      }

      return json(res, 200, {
        accounts: await listPayoutAccounts({ admin, merchantId, userId: user.id, storeId }),
        max_accounts: 5,
        payout_providers: listPayoutProviderNames()
      });
    }

    if (url.pathname === '/api/payout/accounts' && req.method === 'POST') {
      const user = await authenticate(req);
      const body = await readJson(req);
      if (!body.merchantId || !body.storeId) {
        return json(res, 400, { error: 'merchantId and storeId are required' });
      }

      const result = await registerPayoutAccount({
        admin,
        merchantId: body.merchantId,
        userId: user.id,
        storeId: body.storeId,
        input: {
          bankCode: body.bankCode,
          bankName: body.bankName,
          accountName: body.accountName,
          accountNumber: body.accountNumber,
          accountType: body.accountType
        },
        secretStore
      });
      return json(res, 201, {
        account: result,
        next_step: 'VERIFY_PAYOUT_ACCOUNT',
        warning: 'This account cannot receive withdrawals until it is verified and ACTIVE.'
      });
    }

    if (url.pathname === '/api/payout/accounts/verify' && req.method === 'POST') {
      const user = await authenticate(req);
      const body = await readJson(req);
      if (!body.merchantId || !body.storeId || !body.payoutAccountId || !body.provider) {
        return json(res, 400, { error: 'merchantId, storeId, payoutAccountId and provider are required' });
      }

      const result = await verifyPayoutAccount({
        admin,
        merchantId: body.merchantId,
        userId: user.id,
        storeId: body.storeId,
        payoutAccountId: body.payoutAccountId,
        provider: body.provider,
        payoutProviders: getPayoutProviders(),
        secretStore
      });
      return json(res, 200, result);
    }

    if (url.pathname === '/api/payout/accounts/default' && req.method === 'POST') {
      const user = await authenticate(req);
      const body = await readJson(req);
      if (!body.merchantId || !body.storeId || !body.payoutAccountId || body.confirm !== true) {
        return json(res, 400, { error: 'merchantId, storeId, payoutAccountId and confirm=true are required' });
      }

      return json(res, 200, await setDefaultPayoutAccount({
        admin,
        merchantId: body.merchantId,
        userId: user.id,
        storeId: body.storeId,
        payoutAccountId: body.payoutAccountId
      }));
    }

    if (url.pathname === '/api/withdrawals' && req.method === 'GET') {
      const user = await authenticate(req);
      const merchantId = url.searchParams.get('merchantId');
      const storeId = url.searchParams.get('storeId');
      if (!merchantId || !storeId) {
        return json(res, 400, { error: 'merchantId and storeId are required' });
      }

      return json(res, 200, {
        withdrawals: await listWithdrawals({
          admin,
          merchantId,
          userId: user.id,
          storeId,
          limit: url.searchParams.get('limit') || 50
        })
      });
    }

    if (url.pathname === '/api/withdrawals' && req.method === 'POST') {
      const user = await authenticate(req);
      const body = await readJson(req);
      if (!body.merchantId || !body.storeId || !body.payoutAccountId || !body.amount) {
        return json(res, 400, { error: 'merchantId, storeId, payoutAccountId and amount are required' });
      }
      if (body.confirm !== true) {
        return json(res, 409, {
          error: 'WITHDRAWAL_CONFIRMATION_REQUIRED',
          message: 'Withdrawal is a high-risk action. Confirm the selected registered account and amount first.'
        });
      }

      const result = await requestWithdrawal({
        admin,
        merchantId: body.merchantId,
        userId: user.id,
        storeId: body.storeId,
        payoutAccountId: body.payoutAccountId,
        amount: Number(body.amount),
        fee: Number(body.fee || 0),
        currency: body.currency || 'THB',
        metadata: body.metadata || {}
      });
      return json(res, 201, {
        withdrawal: result,
        next_step: result.risk_status === 'PASS' ? 'SUBMIT_TO_PAYOUT_PROVIDER' : 'MANUAL_RISK_REVIEW',
        warning: 'Funds are reserved, not paid. Final status requires provider confirmation.'
      });
    }

    if (url.pathname === '/api/withdrawals/submit' && req.method === 'POST') {
      const user = await authenticate(req);
      const body = await readJson(req);
      if (!body.merchantId || !body.withdrawalId || !body.provider || body.confirm !== true) {
        return json(res, 400, { error: 'merchantId, withdrawalId, provider and confirm=true are required' });
      }

      const result = await submitWithdrawalToProvider({
        admin,
        merchantId: body.merchantId,
        userId: user.id,
        withdrawalId: body.withdrawalId,
        provider: body.provider,
        payoutProviders: getPayoutProviders(),
        secretStore
      });
      return json(res, 200, {
        withdrawal: result,
        warning: 'PROCESSING is not PAID. Final success requires authoritative provider response/webhook.'
      });
    }

    // Outbound and inbound webhooks
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

    if (url.pathname.startsWith('/api/webhooks/payout/') && req.method === 'POST') {
      const provider = decodeURIComponent(url.pathname.split('/').pop());
      setRequestProviderActor(req, provider);
      const rawBody = await readRaw(req, 1024 * 1024);
      const result = await processInboundPayoutWebhook({
        admin,
        provider,
        rawBody,
        headers: req.headers,
        payoutProviders: getPayoutProviders(),
        dispatchOutbound,
        runAutomations
      });
      return json(res, result.status, result.body);
    }

    if (url.pathname.startsWith('/api/webhooks/in/') && req.method === 'POST') {
      const provider = decodeURIComponent(url.pathname.split('/').pop());
      setRequestProviderActor(req, provider);
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
    markRequestError(req, error);
    console.error(error);

    const code = error.code || error.message || '';
    const status = /Unauthorized/.test(error.message) ? 401
      : /Forbidden/.test(error.message) ? 403
      : /SUBSCRIPTION_REQUIRED|SUBSCRIPTION_EXPIRED|INSUFFICIENT_AI_TOKENS/.test(code) ? 402
      : /STORE_PAYOUT_ACCOUNT_LIMIT_REACHED|WITHDRAWAL_CONFIRMATION_REQUIRED/.test(code) ? 409
      : /CLIENT_LOG_RATE_LIMITED/.test(code) ? 429
      : /CLIENT_EVENT_NOT_ALLOWED|AUTH_EVENT_NOT_ALLOWED/.test(code) ? 400
      : /PAYOUT_ACCOUNT_NOT_VERIFIED_ACTIVE|PAYOUT_ACCOUNT_STORE_MISMATCH|PAYOUT_ACCOUNT_NOT_YET_AVAILABLE|INSUFFICIENT_AVAILABLE_BALANCE|WITHDRAWAL_BELOW_MINIMUM|WITHDRAWAL_ABOVE_MAXIMUM|DAILY_WITHDRAWAL_LIMIT_EXCEEDED|WITHDRAWAL_REQUIRES_RISK_APPROVAL/.test(code) ? 422
      : 500;

    return json(res, status, {
      error: status === 500 ? 'internal_error' : (error.code || error.message),
      message: error.userMessage || (status === 500 ? error.message : undefined),
      next_action: error.nextAction || undefined
    });
  }
});

server.listen(port, () => {
  console.log(`AnnyPay running on http://localhost:${port}`);
  console.log(`AI Gateway: ${aiProvider ? 'configured' : 'not configured'}`);
  console.log('Unified Audit Logging: enabled');
  console.log('Billing: enabled');
  console.log('Payout accounts: max 5 per store');
  console.log(`Payment Providers: ${Object.keys(getPaymentProviders()).join(', ') || 'none'}`);
  console.log(`Payout Providers: ${listPayoutProviderNames().join(', ') || 'none'}`);
});

async function authenticate(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) throw new Error('Unauthorized');
  const token = auth.slice(7);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new Error('Unauthorized');
  setRequestActor(req, data.user);
  return data.user;
}

async function authenticateOptional(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const token = auth.slice(7);
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return null;
    setRequestActor(req, data.user);
    return data.user;
  } catch {
    return null;
  }
}

async function readJson(req) {
  const raw = await readRaw(req, 256 * 1024);
  try {
    const body = raw ? JSON.parse(raw) : {};
    enrichRequestAudit(req, body);
    return body;
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', chunk => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
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
    res.writeHead(200, {
      'content-type': mime(file),
      'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=300'
    });
    res.end(data);
  } catch {
    return text(res, 404, 'Not Found');
  }
}

function mime(file) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
  })[extname(file).toLowerCase()] || 'application/octet-stream';
}

function json(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

function text(res, status, data) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(data);
}
