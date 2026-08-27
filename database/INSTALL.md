# AnnyPay Database + Backoffice — Install Order

Run these files in Supabase SQL Editor in this exact order:

1. `schema.sql`
2. `policies.sql`
3. `onboarding.sql`
4. `commerce.sql`
5. `checkout-hardening.sql`
6. `backoffice.sql`
7. `secrets.sql`
8. `billing.sql`
9. `frontend-bridge.sql`

Then put only the **public** Supabase Project URL and **public anon key** into root `config.js`.

## Server environment

Set these as secret environment variables on the trusted Node backend host:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ANNYPAY_MASTER_KEY
AI_GATEWAY_URL
AI_GATEWAY_API_KEY
AI_MODEL
AI_DEFAULT_MAX_OUTPUT_TOKENS
BILLING_PROVIDER
PAYMENT_* variables required by the connected Provider Adapter
```

`ANNYPAY_MASTER_KEY` must be a base64 encoded 32-byte random key. It encrypts integration secrets stored server-side in `integration_secrets`.

Never put these values in browser code or GitHub:

- Supabase service role key
- ANNYPAY_MASTER_KEY
- AI Gateway API key
- Payment provider secret/API key
- Webhook signing secret
- Private key
- Database password

## Start backend

```text
npm install
npm start
```

Default runtime: `http://localhost:3000`

Important pages:

```text
/index.html            Merchant Login / Home
/backoffice.html       Full AI Backoffice
/billing.html          Membership + AI Token Wallet
/commerce-admin.html   SalePage + Payment Link Builder
/store.html            Public Storefront (Store catalog)
/sale.html             Public SalePage / Checkout
/pay.html              Public Payment Link page
```

APIs:

```text
GET  /api/health
POST /api/ai/command
GET  /api/billing/store/:storeId?merchantId=...
POST /api/billing/subscription
POST /api/billing/token-purchase
POST /api/webhooks/out
POST /api/webhooks/in/:provider
```

## Frontend ↔ Backoffice Source of Truth

หน้าบ้านและหลังบ้านต้องใช้ Database ชุดเดียวกันและห้ามมี catalog/order/payment state แยกคนละชุด

```text
BACKOFFICE
Store / Product / Content / SalePage
        ↓ write
PostgreSQL / Supabase
        ↓ public publishable RPC
STORE FRONT
store.html?store=<store_slug>
        ↓
SalePage
sale.html?store=<store_slug>&page=<page_slug>
        ↓ checkout
create_public_order()
        ↓
orders + order_items
        ↓ read
BACKOFFICE Orders / Dashboard
        ↓
Payment Intent / Provider
        ↓
Verified Webhook IN
        ↓
payment_transactions + orders = PAID
        ↓
BACKOFFICE updates from the same authoritative data
```

`get_public_store_catalog()` exposes only Store=`PUBLISHED`, Product=`ACTIVE`, SalePage=`PUBLISHED` data required by the storefront. Draft/private backoffice data must never leak to anonymous users.

### Publish behavior

- Backoffice changes a Store/Product/SalePage in the same database.
- Draft content remains backoffice-only.
- Once Store is `PUBLISHED`, Product is `ACTIVE`, and a SalePage is `PUBLISHED`, the product appears on `store.html` automatically.
- Product price/description changes in backoffice are reflected on the public storefront on the next read; the public browser is not the source of truth.
- Customer checkout creates the Order in the same `orders` table that the backoffice reads.
- Payment status changes only from trusted Provider/Webhook processing and is therefore reflected back into Orders/Dashboard automatically.

## Current flows

### Merchant / Backoffice
Magic Link → Merchant onboarding → Backoffice → Store → Membership → AI Token Wallet → Product → Content → SalePage → Online Sales → Order → Payment

### Membership + AI Tokens
Each `store_id` has its own monthly subscription and AI Token wallet.

```text
Store
→ Choose Subscription Plan
→ Subscription Invoice PENDING
→ Billing Payment Provider
→ Verified Payment/Webhook
→ Subscription ACTIVE
→ Monthly AI Token Grant
→ AI Enabled
```

AI usage:

```text
Prompt
→ Resolve Billing Store
→ Check ACTIVE/TRIAL Subscription
→ Check Token Balance
→ Load SKILL.md + Billing Skill + Domain Skill
→ AI Provider
→ Measure actual Input/Output Tokens
→ Atomic Token Deduction
→ Usage Record + Token Ledger + AI Audit
```

When monthly + top-up balance is insufficient:

```text
AI Locked
→ Select Token Pack
→ Token Purchase PENDING
→ Verified Payment
→ Grant Top-up Token
→ AI Unlocked
```

Monthly Token resets per billing period. Purchased Top-up Token is stored separately and is not cleared by monthly reset. Price, monthly quota, and Token Pack values are configurable in `subscription_plans` and `token_packs`; they are not hard-coded in the Skill.

### AI
Prompt → Master SKILL.md + Core Billing Skill + Domain Skill → Subscription/Token Check → Intent → Permission/Risk Check → Domain Service → Token Meter → AI Audit → Event Bus

### Public Storefront
Backoffice publishes Store + Product + SalePage → `store.html?store=<store_slug>` reads `get_public_store_catalog()` → customer selects product → SalePage → Checkout

### SalePage
Backoffice/Commerce Manager → Publish Store + SalePage → `sale.html?store=<store_slug>&page=<page_slug>` → Customer Checkout → `orders` + `order_items` → `PENDING`

### Payment Link
Backoffice/Commerce Manager → Payment Link → `pay.html?link=<slug>` → Customer details → Order record → `PENDING`

### Payment
Order PENDING → Payment Provider Adapter → Payment Intent → Customer Payment → Webhook IN → Verify Signature → Validate Amount/Currency → Transaction PAID → Order PAID → Event Bus → Webhook OUT / Automation

### Webhook OUT
Merchant creates HTTPS Endpoint via trusted backend → Server generates signing secret → secret encrypted server-side → Event → HMAC signed delivery → retry/log/dead-letter

## Stock rule

Anonymous `PENDING` checkout does **not** decrement stock after `checkout-hardening.sql`. Stock mutation must happen in a trusted paid/reservation flow.

## Payment and Billing Authority

Neither Browser, AI Prompt, `store.html`, `sale.html`, `pay.html`, nor `billing.html` can mark payments, subscriptions, invoices, or token purchases as `PAID`.

Only a trusted backend receiving a verified Payment Provider webhook/reconciliation may:

- mark commerce payment `PAID`
- mark subscription invoice `PAID`
- activate a subscription
- grant monthly AI Tokens
- mark Token Pack purchase `PAID`
- grant Top-up Tokens

## Before public production traffic

Add/verify:

- Bot protection (Turnstile or equivalent)
- API/edge rate limiting
- order abuse/fraud detection
- checkout idempotency key
- inventory reservation / expiry
- concrete Payment Provider Adapter
- recurring/subscription billing support or monthly invoice collection
- verified billing webhook routing to subscription/token grant services
- signed Provider webhook verification with raw-body handling
- secret rotation policy
- outbound webhook queue/worker rather than in-request delivery
- delivery replay tooling and dead-letter operations
- AI usage reconciliation against provider usage reports
- observability/alerts
- backup/recovery and retention policies

Do not treat Commerce/Payment/Billing V1 as production payment processing until the Provider Adapter, billing verification, webhook verification and operational controls are configured and tested end-to-end.
