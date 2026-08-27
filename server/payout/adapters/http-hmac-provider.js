import crypto from 'node:crypto';
import { PayoutProvider } from '../provider.js';

export class HmacHttpPayoutProvider extends PayoutProvider {
  constructor({ name, baseUrl, apiKey, webhookSecret, verifyAccountPath='/beneficiaries/verify', payoutPath='/payouts', statusPath='/payouts/{id}', signatureHeader='x-signature' }) {
    super(name || 'hmac-http');
    if (!baseUrl || !webhookSecret) throw new Error('Payout baseUrl and webhookSecret are required');
    this.baseUrl=baseUrl.replace(/\/$/,'');
    this.apiKey=apiKey||null;
    this.webhookSecret=webhookSecret;
    this.verifyAccountPath=verifyAccountPath;
    this.payoutPath=payoutPath;
    this.statusPath=statusPath;
    this.signatureHeader=signatureHeader.toLowerCase();
  }

  async verifyAccount(input) {
    const data=await this.#post(this.verifyAccountPath,{
      bank_code:input.bankCode,bank_name:input.bankName,account_name:input.accountName,
      account_number:input.accountNumber,account_type:input.accountType,reference:input.reference
    });
    return { verified:data.verified===true, final:data.final===true, availableAt:data.available_at||null, raw:data };
  }

  async createPayout(input) {
    const data=await this.#post(this.payoutPath,{
      withdrawal_ref:input.withdrawalRef,amount:input.amount,gross_amount:input.grossAmount,
      fee:input.fee,currency:input.currency,bank_code:input.bankCode,bank_name:input.bankName,
      account_name:input.accountName,account_number:input.accountNumber,metadata:input.metadata||{}
    });
    return {
      providerPayoutId:data.provider_payout_id||data.id,
      status:String(data.status||'PROCESSING').toUpperCase(),
      final:data.final===true,
      completedAt:data.completed_at||null,
      reason:data.reason||null,
      raw:data
    };
  }

  async getPayoutStatus(providerPayoutId) {
    const path=this.statusPath.replace('{id}',encodeURIComponent(providerPayoutId));
    return this.#get(path);
  }

  async verifyWebhook(rawBody, headers) {
    const supplied=String(headers?.[this.signatureHeader]||headers?.[this.signatureHeader.toLowerCase()]||'').replace(/^sha256=/i,'');
    if (!supplied) return false;
    const expected=crypto.createHmac('sha256',this.webhookSecret).update(String(rawBody)).digest('hex');
    try {
      const a=Buffer.from(supplied,'hex'),b=Buffer.from(expected,'hex');
      return a.length===b.length && crypto.timingSafeEqual(a,b);
    } catch { return false; }
  }

  async normalizeWebhookEvent(rawBody) {
    const body=typeof rawBody==='string'?JSON.parse(rawBody):rawBody;
    return {
      externalEventId:body.event_id||body.id,
      type:normalizeType(body.type||body.event_type||body.status),
      providerPayoutId:body.provider_payout_id||body.payout_id||body.data?.payout_id||null,
      withdrawalRef:body.withdrawal_ref||body.data?.withdrawal_ref||null,
      providerStatus:String(body.status||body.data?.status||'').toUpperCase()||null,
      occurredAt:body.occurred_at||body.created_at||new Date().toISOString(),
      reason:body.reason||body.data?.reason||null,
      raw:body
    };
  }

  async #post(path,body){return this.#request(path,{method:'POST',body:JSON.stringify(body)})}
  async #get(path){return this.#request(path,{method:'GET'})}
  async #request(path,options){
    const headers={'content-type':'application/json'};
    if(this.apiKey)headers.authorization=`Bearer ${this.apiKey}`;
    const response=await fetch(this.baseUrl+path,{...options,headers,signal:AbortSignal.timeout(20000)});
    const text=await response.text();let data;try{data=text?JSON.parse(text):{}}catch{data={text}}
    if(!response.ok)throw new Error(data.error||data.message||`Payout Provider HTTP ${response.status}`);
    return data;
  }
}

function normalizeType(value){
  const v=String(value||'').toLowerCase();
  if(v.includes('paid')||v.includes('success')||v.includes('complete'))return 'payout.paid';
  if(v.includes('reject'))return 'payout.rejected';
  if(v.includes('fail'))return 'payout.failed';
  return 'payout.processing';
}
