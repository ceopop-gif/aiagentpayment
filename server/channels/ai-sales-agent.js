export async function createOmnichannelSalesReply({ admin, aiProvider, merchantId, storeId, conversationId, customerText, provider }) {
  if (!aiProvider) return null;

  const [{ data: merchant }, { data: store }, { data: products }, { data: recent }] = await Promise.all([
    admin.from('merchants').select('business_name,business_type').eq('id', merchantId).maybeSingle(),
    storeId ? admin.from('stores').select('id,store_name,description,currency,status').eq('id', storeId).eq('merchant_id', merchantId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('products').select('id,product_name,short_description,price,sale_price,stock,status').eq('merchant_id', merchantId).eq('status', 'ACTIVE').order('updated_at', { ascending: false }).limit(20),
    admin.from('omni_messages').select('direction,sender_type,text_content,created_at').eq('conversation_id', conversationId).eq('merchant_id', merchantId).order('created_at', { ascending: false }).limit(20)
  ]);

  const catalog = (products || []).map(p => ({
    id: p.id,
    name: p.product_name,
    description: p.short_description,
    price: Number(p.sale_price ?? p.price ?? 0),
    stock: p.stock
  }));
  const history = (recent || []).reverse().filter(x => x.text_content).map(x => ({
    role: x.direction === 'IN' ? 'customer' : x.sender_type === 'AI' ? 'assistant' : 'staff',
    text: x.text_content
  }));

  const instructions = [
    'You are AnyPay AI Sales Agent for a merchant.',
    'Reply naturally in the customer language. Thai customer => Thai reply.',
    'Use only merchant/store/product facts supplied in context. Never invent reviews, certifications, health claims, stock, prices or payment success.',
    'Be concise and sales-helpful. Ask one useful follow-up question if information is missing.',
    'Recommend at most 3 relevant products. If the customer is ready to buy, say that you can send the checkout/payment link; do not claim payment is complete.',
    'Never request card passwords, OTPs, CVV, banking passwords or other secrets in chat.',
    'If a complaint, refund dispute, suspicious payment or high-risk issue appears, recommend human handoff instead of pretending it is resolved.',
    'Return JSON with keys: text, intent, sales_stage, recommended_product_ids, needs_human. text must be customer-facing.'
  ].join('\n');

  const result = await aiProvider.generateText({
    task: 'omnichannel_sales_reply',
    instructions,
    input: {
      provider,
      merchant: merchant || {},
      store: store || {},
      catalog,
      conversation: history,
      latest_customer_message: customerText
    },
    response_format: 'json'
  });

  let parsed = result?.json || result?.output || result?.data || result;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { parsed = { text: parsed }; }
  }
  const replyText = parsed?.text || result?.text;
  if (!replyText) return null;

  const stage = normalizeStage(parsed?.sales_stage);
  if (stage) {
    await admin.from('omni_conversations').update({
      sales_stage: stage,
      context: {
        last_intent: parsed?.intent || null,
        recommended_product_ids: Array.isArray(parsed?.recommended_product_ids) ? parsed.recommended_product_ids.slice(0, 3) : [],
        needs_human: Boolean(parsed?.needs_human),
        updated_by: 'AI_SALES_AGENT'
      },
      updated_at: new Date().toISOString()
    }).eq('id', conversationId).eq('merchant_id', merchantId);
  }

  return {
    text: String(replyText).trim(),
    intent: parsed?.intent || null,
    salesStage: stage,
    recommendedProductIds: Array.isArray(parsed?.recommended_product_ids) ? parsed.recommended_product_ids.slice(0, 3) : [],
    needsHuman: Boolean(parsed?.needs_human)
  };
}

function normalizeStage(value) {
  const stage = String(value || '').toUpperCase();
  return ['NEW','QUALIFYING','RECOMMENDED','CHECKOUT_SENT','PAYMENT_PENDING','PAID','LOST'].includes(stage) ? stage : null;
}
