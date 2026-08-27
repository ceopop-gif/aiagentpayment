# AnnyPay AI Commerce + Payment

**AI Operating System for Commerce & Payment**

**Core Flow:** Prompt → Store → Product → Content → SalePage → Checkout → Payment → Order → Settlement → Automation

## System status

This repository now contains the Merchant UI, full AI Backoffice shell, Supabase/PostgreSQL schema, Commerce checkout flow, AI Skill/Router architecture, Payment Provider adapter contract, Webhook IN/OUT engine, Event Bus, Automation runner and Node backend runtime.

A real Supabase project, AI Gateway and concrete Payment Provider adapter still need to be configured before production use.

## Main pages

- `index.html` — Login / Merchant onboarding / basic Merchant Dashboard
- `backoffice.html` — Full AI Backoffice
- `commerce-admin.html` — SalePage + Payment Link builder
- `sale.html` — Public SalePage / checkout
- `pay.html` — Public Payment Link page

## Backoffice modules

```text
AI Home
Dashboard
Store Builder
Products
Content Studio
SalePage
Online Sales
Payment
Webhook & Integrations
Orders
Automations
AI Action Log
```

## AI architecture

`SKILL.md` is the authoritative Master Skill (v2.0.0).

Runtime flow:

```text
Prompt
→ load SKILL.md + domain skill
→ Intent classification
→ Merchant/Role permission check
→ Risk check
→ Domain Service
→ Database
→ AI Audit
→ Event Bus
→ Webhook OUT / Automation
```

Domain skills are under `skills/`.

## Backend architecture

```text
server/
├── ai/             Skill loader, provider-neutral AI gateway, router
├── services/       Store, Product, Content, SalePage, Payment, Order, Webhook, Automation
├── payment/        Provider registry + adapter contract
├── webhooks/       Verified inbound + signed outbound delivery
├── events/         Internal event bus
├── automation/     Event automation runner
├── secrets/        AES-256-GCM encrypted integration secret store
├── lib/            Trusted Supabase client / authorization
└── server.js       Node HTTP runtime + static web server
```

## APIs

```text
GET  /api/health
POST /api/ai/command
POST /api/webhooks/out
POST /api/webhooks/in/:provider
```

## Database install

Run SQL files using the order in `database/INSTALL.md`.

Current install sequence:

```text
schema.sql
policies.sql
onboarding.sql
commerce.sql
checkout-hardening.sql
backoffice.sql
secrets.sql
```

## Start locally / on a Node host

```bash
npm install
npm start
```

Default: `http://localhost:3000`

Copy environment placeholders from `.env.example` into the hosting platform's secret environment variables.

## Payment security rule

**Browser and AI are never payment authority.**

```text
Customer
→ Payment Provider
→ Webhook IN
→ Verify signature
→ Validate transaction / amount / currency
→ Transaction PAID
→ Order PAID
→ Internal Event
→ Webhook OUT / Automation
```

No payment provider is enabled by default. A concrete adapter must be implemented and registered before AnnyPay claims that provider/channel is available.

## Webhook OUT

Outbound events are HTTPS-only in production, HMAC SHA-256 signed, protected from local/private SSRF destinations, logged, retried and moved to dead-letter state after retry exhaustion.

Signing secrets are encrypted server-side and are never stored in `config.js` or Browser storage.

## Production requirements still to complete

- Create/configure Supabase project
- Configure Auth redirect URLs
- Configure AI Gateway/provider implementation
- Implement/register real Payment Provider Adapter
- Production webhook queue/worker
- Bot protection + rate limiting
- Checkout idempotency + inventory reservation
- Fraud/risk rules
- Observability/alerts
- Backup/retention policies
- KYC/Provider production approval process

## Repository

Owner: `ceopop-gif`  
Project: `aiagentpayment`
