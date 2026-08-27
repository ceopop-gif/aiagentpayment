import { buildSkillContext } from './skill-loader.js';
import { requireMerchantMember } from '../lib/supabase-admin.js';
import { createStore, publishStore } from '../services/store-service.js';
import { createProduct, updateProduct } from '../services/product-service.js';
import { generateContent, approveContent } from '../services/content-service.js';
import { createSalePage, publishSalePage } from '../services/salepage-service.js';
import { createPaymentIntent } from '../services/payment-service.js';
import { createPaymentLink } from '../services/payment-link-service.js';
import { getOrder, salesReport } from '../services/order-service.js';
import { registerWebhook, testWebhook } from '../services/webhook-service.js';
import { createAutomationRule } from '../services/automation-service.js';

const HIGH_RISK = new Set([
  'REFUND_PAYMENT','CANCEL_PAYMENT','CHANGE_SETTLEMENT_ACCOUNT',
  'DELETE_STORE','DELETE_MERCHANT','CHANGE_PAYMENT_CREDENTIALS','DISABLE_WEBHOOK_SECURITY'
]);

const DOMAIN_BY_INTENT = {
  CREATE_STORE:'store', EDIT_STORE:'store', PUBLISH_STORE:'store',
  CREATE_PRODUCT:'product', EDIT_PRODUCT:'product',
  CREATE_CONTENT:'content', CREATE_PROMOTION:'content', APPROVE_CONTENT:'content',
  CREATE_SALEPAGE:'salepage', EDIT_SALEPAGE:'salepage', PUBLISH_SALEPAGE:'salepage',
  CREATE_PAYMENT_LINK:'payment', CONNECT_PAYMENT:'payment', CHECK_PAYMENT:'payment', CREATE_PAYMENT_INTENT:'payment',
  CREATE_WEBHOOK_ENDPOINT:'webhook', TEST_WEBHOOK:'webhook',
  CHECK_ORDER:'order', SALES_REPORT:'analytics', CREATE_AUTOMATION:'automation'
};

export async function executeAiCommand({
  admin,
  aiProvider,
  merchantId,
  userId,
  prompt,
  context = {},
  adapters = {},
  secretStore,
  dispatchOutbound,
  runAutomations,
  confirmationToken = null
}) {
  if (!prompt?.trim()) throw new Error('Prompt is required');
  await requireMerchantMember(admin, merchantId, userId);

  let classification;
  if (aiProvider?.classifyIntent) {
    const skill = await buildSkillContext();
    classification = await aiProvider.classifyIntent({
      system: 'You are Anny AI Command Router. Return structured intent data only and follow the supplied skill.',
      skill,
      prompt,
      merchantContext: context
    });
  } else {
    classification = fallbackIntent(prompt);
  }

  const intent = classification?.intent;
  if (!intent || !DOMAIN_BY_INTENT[intent]) throw new Error('Unable to resolve a supported AnnyPay intent');
  const domain = DOMAIN_BY_INTENT[intent];
  const parameters = classification.parameters || {};

  if (HIGH_RISK.has(intent) && !confirmationToken) {
    return auditAndReturn(admin, {
      merchantId, userId, prompt, intent, domain,
      target: parameters.id || null,
      status: 'REQUIRES_CONFIRMATION',
      result: { message: 'This action requires explicit confirmation.' }
    });
  }

  if (classification.missing?.length) {
    return auditAndReturn(admin, {
      merchantId, userId, prompt, intent, domain,
      status: 'REQUIRES_CONFIRMATION',
      result: { missing: classification.missing, message: 'Additional information is required.' }
    });
  }

  try {
    const result = await dispatchIntent({
      intent, parameters, admin, aiProvider, merchantId, userId,
      adapters, secretStore, dispatchOutbound, runAutomations
    });

    return auditAndReturn(admin, {
      merchantId, userId, prompt, intent, domain,
      target: result?.id || result?.transaction?.id || parameters.id || null,
      status: 'SUCCESS', result
    });
  } catch (error) {
    await auditAndReturn(admin, {
      merchantId, userId, prompt, intent, domain,
      target: parameters.id || null,
      status: 'FAILED', result: { error: error.message }
    });
    throw error;
  }
}

async function dispatchIntent(ctx) {
  const common = {
    admin: ctx.admin, merchantId: ctx.merchantId, userId: ctx.userId,
    dispatchOutbound: ctx.dispatchOutbound, runAutomations: ctx.runAutomations
  };

  switch (ctx.intent) {
    case 'CREATE_STORE': return createStore({ ...common, input: ctx.parameters });
    case 'PUBLISH_STORE': return publishStore({ ...common, storeId: ctx.parameters.storeId });
    case 'CREATE_PRODUCT': return createProduct({ ...common, input: ctx.parameters });
    case 'EDIT_PRODUCT': return updateProduct({ ...common, productId: ctx.parameters.productId, patch: ctx.parameters.patch || {} });
    case 'CREATE_CONTENT':
    case 'CREATE_PROMOTION': return generateContent({ ...common, input: ctx.parameters, aiProvider: ctx.aiProvider });
    case 'APPROVE_CONTENT': return approveContent({ ...common, contentId: ctx.parameters.contentId });
    case 'CREATE_SALEPAGE': return createSalePage({ ...common, input: ctx.parameters });
    case 'PUBLISH_SALEPAGE': return publishSalePage({ ...common, salePageId: ctx.parameters.salePageId });
    case 'CREATE_PAYMENT_LINK': return createPaymentLink({ ...common, input: ctx.parameters });
    case 'CREATE_PAYMENT_INTENT': return createPaymentIntent({ ...common, orderId: ctx.parameters.orderId, provider: ctx.parameters.provider, adapters: ctx.adapters });
    case 'CHECK_ORDER': return getOrder({ admin:ctx.admin, merchantId:ctx.merchantId, userId:ctx.userId, orderNo:ctx.parameters.orderNo });
    case 'SALES_REPORT': return salesReport({ admin:ctx.admin, merchantId:ctx.merchantId, userId:ctx.userId, from:ctx.parameters.from, to:ctx.parameters.to });
    case 'CREATE_WEBHOOK_ENDPOINT': return registerWebhook({ admin:ctx.admin, merchantId:ctx.merchantId, userId:ctx.userId, input:ctx.parameters, secretStore:ctx.secretStore });
    case 'TEST_WEBHOOK': return testWebhook({ admin:ctx.admin, merchantId:ctx.merchantId, userId:ctx.userId, endpointId:ctx.parameters.endpointId, secretStore:ctx.secretStore });
    case 'CREATE_AUTOMATION': return createAutomationRule({ admin:ctx.admin, merchantId:ctx.merchantId, userId:ctx.userId, input:ctx.parameters });
    default: throw new Error(`Intent ${ctx.intent} is registered but its service handler is not implemented yet`);
  }
}

async function auditAndReturn(admin, { merchantId, userId, prompt, intent, domain, target = null, status, result }) {
  const { error } = await admin.from('ai_actions').insert({
    merchant_id: merchantId,
    user_id: userId,
    prompt,
    intent,
    tool: `anny.${domain}`,
    target: target ? String(target) : null,
    result: { ...result, skill_version: '2.0.0' },
    status
  });
  if (error) console.error('AI audit write failed', error);
  return { intent, domain, status, result };
}

function fallbackIntent(prompt) {
  const p = prompt.toLowerCase();
  const name = extractAfter(prompt, 'ชื่อ');
  if (/สร้างร้าน|create store/.test(p)) return { intent:'CREATE_STORE', parameters:{ storeName:name||null }, missing:name?[]:['storeName'] };
  if (/เพิ่มสินค้า|สร้างสินค้า|create product/.test(p)) return { intent:'CREATE_PRODUCT', parameters:{}, missing:['storeId','productName','price'] };
  if (/คอนเทนต์|content|แคปชั่น|headline|โฆษณา/.test(p)) return { intent:'CREATE_CONTENT', parameters:{ contentType:'SALEPAGE_COPY', prompt }, missing:['productId'] };
  if (/salepage|หน้าขาย/.test(p)) return { intent:'CREATE_SALEPAGE', parameters:{}, missing:['storeId','productId'] };
  if (/payment link|ลิงก์รับเงิน|ลิงค์รับเงิน/.test(p)) return { intent:'CREATE_PAYMENT_LINK', parameters:{}, missing:['amount','description'] };
  if (/payment intent|เปิดรับเงิน/.test(p)) return { intent:'CREATE_PAYMENT_INTENT', parameters:{}, missing:['orderId','provider'] };
  if (/order|ออเดอร์|คำสั่งซื้อ/.test(p)) return { intent:'CHECK_ORDER', parameters:{}, missing:['orderNo'] };
  if (/ยอดขาย|sales report|ขายได้เท่า/.test(p)) return { intent:'SALES_REPORT', parameters:{}, missing:[] };
  if (/webhook/.test(p)) return { intent:'CREATE_WEBHOOK_ENDPOINT', parameters:{}, missing:['name','url','events'] };
  return { intent:null, parameters:{}, missing:[] };
}

function extractAfter(text, marker) {
  const i = text.indexOf(marker);
  if (i < 0) return '';
  return text.slice(i + marker.length).trim().split(/[\n,]/)[0]?.trim() || '';
}
