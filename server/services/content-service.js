import { requireMerchantMember } from '../lib/supabase-admin.js';
import { buildSkillContext } from '../ai/skill-loader.js';
import { makeEvent, publishEvent } from '../events/event-bus.js';

export async function generateContent({ admin, merchantId, userId, input, aiProvider, dispatchOutbound, runAutomations }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN', 'STAFF']);
  if (!aiProvider) throw new Error('AI provider is not configured');
  if (!input?.contentType) throw new Error('contentType is required');

  let product = null;
  if (input.productId) {
    const { data, error } = await admin.from('products')
      .select('id,store_id,product_name,short_description,description,price,sale_price,stock,seo_title,seo_description,status')
      .eq('id', input.productId).eq('merchant_id', merchantId).single();
    if (error) throw error;
    product = data;
  }

  const skill = await buildSkillContext('content');
  const generationPrompt = [
    skill,
    '\n# TASK',
    `Create ${input.contentType} content for the merchant.`,
    `Language: ${input.language || 'th'}`,
    `Tone: ${input.tone || 'clear, persuasive, factual'}`,
    `Merchant instruction: ${input.prompt || ''}`,
    `Product context: ${JSON.stringify(product || {}, null, 2)}`,
    '\nRules: Do not invent reviews, certifications, health claims, ingredients or guarantees that are not in the product context.'
  ].join('\n');

  const generated = await aiProvider.generateText({
    system: 'You are Anny Content Agent. Follow the supplied AnnyPay Skill strictly.',
    prompt: generationPrompt,
    temperature: input.temperature ?? 0.5
  });

  const text = typeof generated === 'string' ? generated : generated?.text;
  if (!text?.trim()) throw new Error('AI provider returned empty content');

  const record = {
    merchant_id: merchantId,
    store_id: input.storeId || product?.store_id || null,
    product_id: input.productId || null,
    content_type: input.contentType,
    language: input.language || 'th',
    tone: input.tone || null,
    prompt: input.prompt || null,
    content: text.trim(),
    status: 'DRAFT',
    ai_model: generated?.model || aiProvider.name || null,
    skill_version: '2.0.0',
    created_by: userId
  };

  const { data, error } = await admin.from('content_assets').insert(record).select('*').single();
  if (error) throw error;

  const event = makeEvent({ merchantId, type: 'content.created', resourceType: 'content_asset', resourceId: data.id, data: {
    id: data.id,
    product_id: data.product_id,
    content_type: data.content_type,
    status: data.status
  }});
  await publishEvent({ admin, event, dispatchOutbound, runAutomations });
  return data;
}

export async function approveContent({ admin, merchantId, userId, contentId }) {
  await requireMerchantMember(admin, merchantId, userId, ['OWNER', 'ADMIN', 'STAFF']);
  const { data, error } = await admin.from('content_assets')
    .update({ status: 'APPROVED', updated_at: new Date().toISOString() })
    .eq('id', contentId).eq('merchant_id', merchantId).select('*').single();
  if (error) throw error;
  return data;
}
