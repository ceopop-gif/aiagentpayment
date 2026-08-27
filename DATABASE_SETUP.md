# AnnyPay Database V1 Setup

AnnyPay Database V1 is designed for PostgreSQL/Supabase and follows the merchant-isolated architecture defined in `SKILL.md`.

## 1. Create Supabase project

Create a new Supabase project and keep these values outside Git:

- Project URL
- Anon public key
- Service role key (server only)

Copy `.env.example` to your deployment environment and replace placeholders there. Never commit the real service role key or payment secrets.

## 2. Create schema

Open Supabase SQL Editor and run:

1. `database/schema.sql`
2. `database/policies.sql`

This creates Merchant, Store, Product, SalePage, Customer, Order, Payment, Settlement and AI audit tables.

## 3. Authentication flow

Use Supabase Auth for account creation and sign-in. After the first login:

1. Create `profiles` row for `auth.uid()`.
2. Create a `merchants` row with `owner_user_id = auth.uid()`.
3. Create `merchant_members` row with role `OWNER`.
4. All merchant-facing queries then pass through Row Level Security.

## 4. Frontend connection

`src/lib/supabase.js` contains the browser-side Supabase client helper. Only the public/anon key belongs in frontend code.

The current root `index.html` is still the UI prototype. Next integration step is to replace demo values with queries for:

- current merchant
- stores
- products
- orders
- payment transactions
- settlements
- AI actions

## 5. Payment security

The browser must never directly write these authoritative records:

- `payment_transactions`
- `payment_webhooks`
- `refunds`
- `settlements`
- payment credentials

Use a trusted server with the Supabase service role and the connected payment-provider API.

`server/payment-webhook.js` intentionally fails signature verification until the real provider adapter is configured. Do not weaken this behavior for testing production payments.

## 6. Payment state rule

Only a verified provider webhook/server reconciliation may move a transaction to `PAID`.

Expected flow:

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

## Next build phase

1. Create Supabase project.
2. Run schema + policies.
3. Connect login screen.
4. Connect Merchant Dashboard to live data.
5. Connect Store/Product CRUD.
6. Connect Order creation.
7. Add provider-specific Payment Adapter + Webhook.
