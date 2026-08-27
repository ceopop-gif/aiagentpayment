// Server-side only. Do not run this code in the browser.
// Provider-specific signature verification must be implemented before production use.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function verifyProviderSignature({ rawBody, signature }) {
  // TODO: Replace with the exact algorithm required by the connected payment provider.
  // Fail closed until provider documentation and webhook secret are configured.
  if (!process.env.PAYMENT_WEBHOOK_SECRET) return false;
  if (!rawBody || !signature) return false;
  return false;
}

export async function handlePaymentWebhook({ rawBody, signature, payload }) {
  const provider = process.env.PAYMENT_PROVIDER || 'UNCONFIGURED';
  const signatureValid = verifyProviderSignature({ rawBody, signature });

  const { data: webhookRow, error: webhookError } = await supabase
    .from('payment_webhooks')
    .insert({
      provider,
      event_id: payload?.id || null,
      event_type: payload?.type || null,
      signature_valid: signatureValid,
      payload: payload || {},
      processed: false
    })
    .select('id')
    .single();

  if (webhookError) throw webhookError;

  if (!signatureValid) {
    throw new Error('Invalid payment webhook signature');
  }

  // IMPORTANT: Map provider event fields only after the provider adapter is implemented.
  // Never mark a payment PAID based on a browser request or merchant-entered text.
  // Expected production flow:
  // 1) Verify signature
  // 2) Validate provider transaction/order identifiers
  // 3) Lock/read transaction
  // 4) Update payment_transactions
  // 5) Update orders
  // 6) Mark webhook processed

  await supabase
    .from('payment_webhooks')
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq('id', webhookRow.id);

  return { accepted: true };
}
