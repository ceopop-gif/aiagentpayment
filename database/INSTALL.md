# AnnyPay Database + Backoffice — Install Order

Run these files in Supabase SQL Editor in this exact order:

1. `schema.sql`
2. `policies.sql`
3. `onboarding.sql`
4. `commerce.sql`
5. `checkout-hardening.sql`
6. `backoffice.sql`
7. `secrets.sql`

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
/commerce-admin.html   SalePage + Payment Link Builder
/sale.html             Public SalePage
/pay.html              Public Payment Link page
```

APIs:

```text
GET  /api/health
POST /api/ai/command
POST /api/webhooks/out
POST /api/webhooks/in/:provider
```

## Current flows

### Merchant / Backoffice
Magic Link → Merchant onboarding → Backoffice → Store → Product → Content → SalePage → Online Sales → Order → Payment

### AI
Prompt → Master SKILL.md + Domain Skill → Intent → Permission/Risk Check → Domain Service → AI Audit → Event Bus

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

## Payment rule

Neither Browser, AI Prompt, `sale.html`, nor `pay.html` can mark a payment as `PAID`.

Only a trusted backend receiving a verified Payment Provider webhook/reconciliation may write authoritative payment state.

## Before public production traffic

Add/verify:

- Bot protection (Turnstile or equivalent)
- API/edge rate limiting
- order abuse/fraud detection
- checkout idempotency key
- inventory reservation / expiry
- concrete Payment Provider Adapter
- signed Provider webhook verification with raw-body handling
- secret rotation policy
- outbound webhook queue/worker rather than in-request delivery
- delivery replay tooling and dead-letter operations
- observability/alerts
- backup/recovery and retention policies

Do not treat Commerce/Payment V1 as production payment processing until the Provider Adapter, webhook verification and operational controls are configured and tested end-to-end.
