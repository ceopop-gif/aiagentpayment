# AnnyPay Database V1 Setup

AnnyPay Database V1 uses PostgreSQL/Supabase and follows the merchant-isolated architecture in `SKILL.md`.

## Current implementation

The root `index.html` is now connected to Supabase-ready application code and supports:

- Magic Link authentication by email
- Merchant onboarding
- Multi-Merchant selector
- Live Dashboard metrics
- Store creation + list
- Product creation + list
- Order list
- Merchant / KYC / Payment status
- Row Level Security per Merchant

Payment-authoritative writes remain server-only.

## 1. Create a Supabase project

Create a Supabase project and obtain:

- Project URL (public)
- Anon key (public browser key)
- Service role key (secret, server only)

Never put the service role key or payment-provider secrets in `config.js` or frontend code.

## 2. Run SQL in this exact order

Open Supabase SQL Editor and run:

1. `database/schema.sql`
2. `database/policies.sql`
3. `database/onboarding.sql`

The third file creates the secure `bootstrap_merchant(...)` RPC used after the first login.

## 3. Configure authentication

The frontend uses Supabase Magic Link / OTP authentication instead of collecting passwords in AnnyPay UI.

In Supabase Authentication URL settings, add the deployed AnnyPay URL to the allowed Redirect URLs.

For local testing, add your local URL as well.

## 4. Connect the frontend

For a permanent shared deployment, edit `config.js` with the two PUBLIC values:

```js
window.ANNYPAY_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_PUBLIC_ANON_KEY"
};
```

Do not place `SUPABASE_SERVICE_ROLE_KEY` in this file.

If `config.js` is blank, AnnyPay displays a setup screen where an administrator can paste the Project URL and Anon Key for that browser only. Those values are stored in browser localStorage.

## 5. Merchant onboarding flow

After authentication:

1. User enters business name and basic Merchant information.
2. Frontend calls `bootstrap_merchant(...)`.
3. Database creates/updates `profiles`.
4. Database creates a `merchants` row.
5. Database creates `merchant_members` with role `OWNER`.
6. Dashboard reloads through Row Level Security.

## 6. Live Dashboard rules

The dashboard reads real data for the selected Merchant:

- number of stores
- number of products
- today's orders
- today's `PAID` orders
- today's paid sales total
- recent orders

No demo sales totals are used after Supabase is connected.

## 7. Store / Product CRUD

Merchant members can create and read Store/Product data through RLS.

The current UI supports:

- create Store
- list Stores
- create Product linked to a Store
- list Products
- read Orders

## 8. Payment security

The browser must never directly write authoritative records:

- `payment_transactions`
- `payment_webhooks`
- `refunds`
- `settlements`
- payment credentials

Use a trusted backend with the Supabase service role and the real payment-provider adapter.

`server/payment-webhook.js` intentionally fails signature verification until a provider-specific verifier is configured.

## 9. Payment state rule

Only a verified provider webhook or trusted server reconciliation may move a transaction to `PAID`.

Customer Payment → Provider → Signed Webhook → Verify Signature → Validate Transaction → Update Payment → Update Order → Notify Merchant/Customer

## Database V1 modules

- Auth / Profiles
- Merchants / Merchant Members
- Multi-Store
- Products / Product Images
- SalePages
- Customers
- Orders / Order Items
- Payment Accounts
- Payment Transactions / Webhooks
- Refunds
- Settlements
- AI Sessions / AI Actions

## Next phase

1. Create the real Supabase project.
2. Run the three SQL files.
3. Put Project URL + Anon Key in `config.js`.
4. Test Magic Link login and Merchant onboarding.
5. Add Customer + Order creation flow.
6. Add SalePage generation and checkout.
7. Connect the real Payment Provider Adapter + verified webhook.
