import { registerPayoutProvider } from './provider-registry.js';
import { HmacHttpPayoutProvider } from './adapters/http-hmac-provider.js';

export function configurePayoutProvidersFromEnv() {
  if (process.env.PAYOUT_ADAPTER_TYPE !== 'hmac-http') return [];
  const name=(process.env.PAYOUT_PROVIDER||'annypay-payout').toLowerCase();
  const adapter=new HmacHttpPayoutProvider({
    name,
    baseUrl:process.env.PAYOUT_API_BASE_URL,
    apiKey:process.env.PAYOUT_API_KEY,
    webhookSecret:process.env.PAYOUT_WEBHOOK_SECRET,
    verifyAccountPath:process.env.PAYOUT_VERIFY_ACCOUNT_PATH||'/beneficiaries/verify',
    payoutPath:process.env.PAYOUT_CREATE_PATH||'/payouts',
    statusPath:process.env.PAYOUT_STATUS_PATH||'/payouts/{id}',
    signatureHeader:process.env.PAYOUT_SIGNATURE_HEADER||'x-signature'
  });
  registerPayoutProvider(name,adapter);
  return [name];
}
