import { buildSkillContext } from './skill-loader.js';
import { requireMerchantMember } from '../lib/supabase-admin.js';
import { createStore, publishStore } from '../services/store-service.js';
import { createProduct, updateProduct } from '../services/product-service.js';
import { generateContent, approveContent } from '../services/content-service.js';
import { createSalePage, publishSalePage } from '../services/salepage-service.js';
import { createPaymentIntent } from '../services/payment-service.js';
import { getOrder, salesReport } from '../services/order-service.js';
import { requireAiEntitlement, consumeAiUsage, getStoreBilling, createTokenPurchaseOrder } from '../services/billing-service.js';
import { getStoreBalance } from '../services/balance-service.js';
import { listPayoutAccounts, requestWithdrawal, listWithdrawals } from '../services/payout-service.js';

const HIGH_RISK=new Set(['REFUND_PAYMENT','CANCEL_PAYMENT','CHANGE_SETTLEMENT_ACCOUNT','DELETE_STORE','DELETE_MERCHANT','CHANGE_PAYMENT_CREDENTIALS','DISABLE_WEBHOOK_SECURITY','REQUEST_WITHDRAWAL','SET_DEFAULT_PAYOUT_ACCOUNT','REMOVE_PAYOUT_ACCOUNT']);
const DOMAIN_BY_INTENT={
  CREATE_STORE:'store',EDIT_STORE:'store',PUBLISH_STORE:'store',CREATE_PRODUCT:'product',EDIT_PRODUCT:'product',
  CREATE_CONTENT:'content',CREATE_PROMOTION:'content',APPROVE_CONTENT:'content',CREATE_SALEPAGE:'salepage',EDIT_SALEPAGE:'salepage',PUBLISH_SALEPAGE:'salepage',
  CREATE_PAYMENT_LINK:'payment',CONNECT_PAYMENT:'payment',CHECK_PAYMENT:'payment',CREATE_PAYMENT_INTENT:'payment',CREATE_WEBHOOK_ENDPOINT:'webhook',TEST_WEBHOOK:'webhook',
  CHECK_ORDER:'order',SALES_REPORT:'analytics',CREATE_AUTOMATION:'automation',CHECK_SUBSCRIPTION:'billing',CHECK_AI_TOKENS:'billing',BUY_AI_TOKENS:'billing',
  CHECK_STORE_BALANCE:'payout',LIST_PAYOUT_ACCOUNTS:'payout',CHECK_WITHDRAWAL:'payout',REQUEST_WITHDRAWAL:'payout'
};

export async function executeAiCommand({admin,aiProvider,merchantId,userId,prompt,context={},adapters={},dispatchOutbound,runAutomations,confirmationToken=null}){
  if(!prompt?.trim())throw new Error('Prompt is required');
  await requireMerchantMember(admin,merchantId,userId);
  let classification,routingBilling=null;
  if(aiProvider?.classifyIntent){
    const skill=await buildSkillContext();
    const estimatedRoutingMinimum=Math.max(1,Math.ceil((skill.length+prompt.length)/4));
    routingBilling=await requireAiEntitlement({admin,merchantId,userId,storeId:context.billingStoreId||context.storeId||null,minimumTokens:estimatedRoutingMinimum});
    classification=await aiProvider.classifyIntent({system:'You are Anny AI Command Router. Return only structured intent data and follow the supplied skill.',skill,prompt,merchantContext:context});
    const charge=await consumeAiUsage({admin,merchantId,userId,storeId:routingBilling.storeId,intent:'ROUTE_INTENT',provider:aiProvider.name,model:classification?.model||null,response:classification,prompt:`${skill}\n${prompt}`,source:'AI_ROUTER',metadata:{requested_intent:classification?.intent||null}});
    routingBilling.remainingAfterRouting=charge.balance;
  }else classification=fallbackIntent(prompt);

  const intent=classification?.intent;if(!intent||!DOMAIN_BY_INTENT[intent])throw new Error('Unable to resolve a supported AnnyPay intent');
  const domain=DOMAIN_BY_INTENT[intent],parameters=classification.parameters||{};
  if(HIGH_RISK.has(intent)&&!confirmationToken)return auditAndReturn(admin,{merchantId,userId,prompt,intent,domain,target:parameters.id||parameters.payoutAccountId||null,status:'REQUIRES_CONFIRMATION',result:{message:'This action requires explicit confirmation.',next_action:intent==='REQUEST_WITHDRAWAL'?'CONFIRM_WITHDRAWAL':'CONFIRM_HIGH_RISK_ACTION',billing:routingBilling?.remainingAfterRouting||null}});
  if(classification.missing?.length)return auditAndReturn(admin,{merchantId,userId,prompt,intent,domain,status:'REQUIRES_CONFIRMATION',result:{missing:classification.missing,message:'Additional information is required.',billing:routingBilling?.remainingAfterRouting||null}});

  try{
    const result=await dispatchIntent({intent,parameters,admin,aiProvider,merchantId,userId,context,adapters,dispatchOutbound,runAutomations,billingStoreId:routingBilling?.storeId||context.billingStoreId||context.storeId||null});
    return auditAndReturn(admin,{merchantId,userId,prompt,intent,domain,target:result?.id||result?.transaction?.id||parameters.id||parameters.payoutAccountId||null,status:'SUCCESS',result:{...result,ai_token_balance:routingBilling?.remainingAfterRouting||undefined}});
  }catch(error){
    const friendly=billingError(error)||payoutError(error);
    await auditAndReturn(admin,{merchantId,userId,prompt,intent,domain,target:parameters.id||parameters.payoutAccountId||null,status:'FAILED',result:{error:error.message,code:error.code||null,...friendly}});
    throw Object.assign(error,friendly?{userMessage:friendly.message,nextAction:friendly.next_action}:{});
  }
}

async function dispatchIntent(ctx){
  const common={admin:ctx.admin,merchantId:ctx.merchantId,userId:ctx.userId,dispatchOutbound:ctx.dispatchOutbound,runAutomations:ctx.runAutomations};
  switch(ctx.intent){
    case 'CREATE_STORE':return createStore({...common,input:ctx.parameters});
    case 'PUBLISH_STORE':return publishStore({...common,storeId:ctx.parameters.storeId});
    case 'CREATE_PRODUCT':return createProduct({...common,input:ctx.parameters});
    case 'EDIT_PRODUCT':return updateProduct({...common,productId:ctx.parameters.productId,patch:ctx.parameters.patch||{}});
    case 'CREATE_CONTENT':case 'CREATE_PROMOTION':return generateContent({...common,input:{...ctx.parameters,billingStoreId:ctx.billingStoreId},aiProvider:ctx.aiProvider});
    case 'APPROVE_CONTENT':return approveContent({...common,contentId:ctx.parameters.contentId});
    case 'CREATE_SALEPAGE':return createSalePage({...common,input:ctx.parameters});
    case 'PUBLISH_SALEPAGE':return publishSalePage({...common,salePageId:ctx.parameters.salePageId});
    case 'CREATE_PAYMENT_INTENT':return createPaymentIntent({...common,orderId:ctx.parameters.orderId,provider:ctx.parameters.provider,adapters:ctx.adapters});
    case 'CHECK_ORDER':return getOrder({admin:ctx.admin,merchantId:ctx.merchantId,userId:ctx.userId,orderId:ctx.parameters.orderId,orderNo:ctx.parameters.orderNo});
    case 'SALES_REPORT':return salesReport({admin:ctx.admin,merchantId:ctx.merchantId,userId:ctx.userId,from:ctx.parameters.from,to:ctx.parameters.to});
    case 'CHECK_SUBSCRIPTION':case 'CHECK_AI_TOKENS':{const storeId=ctx.parameters.storeId||ctx.billingStoreId;if(!storeId)throw new Error('storeId is required');return getStoreBilling({admin:ctx.admin,merchantId:ctx.merchantId,userId:ctx.userId,storeId});}
    case 'BUY_AI_TOKENS':{const storeId=ctx.parameters.storeId||ctx.billingStoreId;if(!storeId||!ctx.parameters.packId)throw new Error('storeId and packId are required');return createTokenPurchaseOrder({admin:ctx.admin,merchantId:ctx.merchantId,userId:ctx.userId,storeId,packId:ctx.parameters.packId,quantity:Number(ctx.parameters.quantity||1),billingProvider:ctx.parameters.provider||null});}
    case 'CHECK_STORE_BALANCE':{const storeId=ctx.parameters.storeId||ctx.billingStoreId;if(!storeId)throw new Error('storeId is required');return getStoreBalance({admin:ctx.admin,merchantId:ctx.merchantId,userId:ctx.userId,storeId,ledgerLimit:10});}
    case 'LIST_PAYOUT_ACCOUNTS':{const storeId=ctx.parameters.storeId||ctx.billingStoreId;if(!storeId)throw new Error('storeId is required');return{accounts:await listPayoutAccounts({admin:ctx.admin,merchantId:ctx.merchantId,userId:ctx.userId,storeId}),max_accounts:5};}
    case 'CHECK_WITHDRAWAL':{const storeId=ctx.parameters.storeId||ctx.billingStoreId;if(!storeId)throw new Error('storeId is required');return{withdrawals:await listWithdrawals({admin:ctx.admin,merchantId:ctx.merchantId,userId:ctx.userId,storeId,limit:ctx.parameters.limit||20})};}
    case 'REQUEST_WITHDRAWAL':{const storeId=ctx.parameters.storeId||ctx.billingStoreId;if(!storeId||!ctx.parameters.payoutAccountId||!ctx.parameters.amount)throw new Error('storeId, payoutAccountId and amount are required');return requestWithdrawal({admin:ctx.admin,merchantId:ctx.merchantId,userId:ctx.userId,storeId,payoutAccountId:ctx.parameters.payoutAccountId,amount:Number(ctx.parameters.amount),fee:Number(ctx.parameters.fee||0),currency:ctx.parameters.currency||'THB',metadata:{source:'AI_CONFIRMED'}});}
    default:throw new Error(`Intent ${ctx.intent} is registered but its service handler is not implemented yet`);
  }
}

async function auditAndReturn(admin,{merchantId,userId,prompt,intent,domain,target=null,status,result}){const{error}=await admin.from('ai_actions').insert({merchant_id:merchantId,user_id:userId,prompt,intent,tool:`anny.${domain}`,target:target?String(target):null,result:{...result,skill_version:'2.0.0',billing_policy:'store-subscription-ai-token-v1',payout_policy:'store-balance-ledger-payout-v2'},status});if(error)console.error('AI audit write failed',error);return{intent,domain,status,result}}
function billingError(error){const code=error?.code||error?.message||'';if(/SUBSCRIPTION_REQUIRED/.test(code))return{message:'ร้านนี้ยังไม่มีสมาชิกที่ใช้งานอยู่ กรุณาเลือกแพ็กเกจรายเดือนก่อนใช้ AI',next_action:'OPEN_SUBSCRIPTION_PLANS'};if(/SUBSCRIPTION_EXPIRED|PAST_DUE/.test(code))return{message:'สมาชิกของร้านหมดอายุหรือมียอดค้าง กรุณาต่ออายุสมาชิกก่อนใช้ AI',next_action:'RENEW_SUBSCRIPTION'};if(/INSUFFICIENT_AI_TOKENS/.test(code))return{message:'AI Token ของร้านไม่เพียงพอ กรุณาซื้อ Token เพิ่มเพื่อทำรายการต่อ',next_action:'BUY_AI_TOKENS'};return null}
function payoutError(error){const code=error?.code||error?.message||'';if(/STORE_PAYOUT_ACCOUNT_LIMIT_REACHED/.test(code))return{message:'ร้านนี้ลงทะเบียนบัญชีรับเงินครบ 5 บัญชีแล้ว',next_action:'OPEN_PAYOUT_ACCOUNTS'};if(/PAYOUT_ACCOUNT_NOT_VERIFIED_ACTIVE/.test(code))return{message:'บัญชีนี้ยังไม่ผ่านการยืนยันหรือยังไม่ ACTIVE',next_action:'SELECT_VERIFIED_PAYOUT_ACCOUNT'};if(/PAYOUT_ACCOUNT_STORE_MISMATCH/.test(code))return{message:'บัญชีรับเงินที่เลือกไม่ได้เป็นบัญชีของร้านนี้',next_action:'SELECT_STORE_PAYOUT_ACCOUNT'};if(/INSUFFICIENT_AVAILABLE_BALANCE/.test(code))return{message:'ยอดเงินที่ถอนได้ของร้านไม่เพียงพอ',next_action:'CHECK_STORE_BALANCE'};return null}

function fallbackIntent(prompt){
  const p=prompt.toLowerCase();
  if(/ยอด.*ถอน|ถอนได้เท่า|available balance|ยอดเงินร้าน/.test(p))return{intent:'CHECK_STORE_BALANCE',parameters:{},missing:['storeId']};
  if(/บัญชี.*ถอน|บัญชีรับเงิน|payout account/.test(p)&&/แสดง|ดู|เช็ก|รายการ/.test(p))return{intent:'LIST_PAYOUT_ACCOUNTS',parameters:{},missing:['storeId']};
  if(/ถอนเงิน|withdraw/.test(p)&&/สถานะ|ล่าสุด|ประวัติ|เช็ก|ดู/.test(p))return{intent:'CHECK_WITHDRAWAL',parameters:{},missing:['storeId']};
  if(/ถอนเงิน|withdraw/.test(p))return{intent:'REQUEST_WITHDRAWAL',parameters:{},missing:['storeId','payoutAccountId','amount']};
  if(/token|โทเคน|เครดิต ai/.test(p)&&/ซื้อ|เพิ่ม|เติม/.test(p))return{intent:'BUY_AI_TOKENS',parameters:{},missing:['storeId','packId']};
  if(/token|โทเคน|เครดิต ai/.test(p)&&/เหลือ|เช็ก|ตรวจ|balance/.test(p))return{intent:'CHECK_AI_TOKENS',parameters:{},missing:['storeId']};
  if(/สมาชิก|subscription|แพ็กเกจ/.test(p)&&/เช็ก|สถานะ|เหลือ|ปัจจุบัน/.test(p))return{intent:'CHECK_SUBSCRIPTION',parameters:{},missing:['storeId']};
  if(/สร้างร้าน|create store/.test(p))return{intent:'CREATE_STORE',parameters:{storeName:extractAfter(prompt,'ชื่อ')||null},missing:['storeName'].filter(()=>!extractAfter(prompt,'ชื่อ'))};
  if(/เพิ่มสินค้า|สร้างสินค้า|create product/.test(p))return{intent:'CREATE_PRODUCT',parameters:{},missing:['storeId','productName','price']};
  if(/คอนเทนต์|content|แคปชั่น|headline|โฆษณา/.test(p))return{intent:'CREATE_CONTENT',parameters:{contentType:'SALEPAGE_COPY',prompt},missing:['productId']};
  if(/salepage|หน้าขาย/.test(p))return{intent:'CREATE_SALEPAGE',parameters:{},missing:['storeId','productId']};
  if(/payment intent|เปิดรับเงิน/.test(p))return{intent:'CREATE_PAYMENT_INTENT',parameters:{},missing:['orderId','provider']};
  if(/ยอดขาย|sales report/.test(p))return{intent:'SALES_REPORT',parameters:{},missing:[]};
  return{intent:null,parameters:{},missing:[]};
}
function extractAfter(text,marker){const i=text.indexOf(marker);if(i<0)return'';return text.slice(i+marker.length).trim().split(/[\n,]/)[0]?.trim()||''}
