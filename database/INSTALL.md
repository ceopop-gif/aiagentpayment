# AnnyPay Database V1 — Install Order

Run these files in Supabase SQL Editor in this exact order:

1. `schema.sql`
2. `policies.sql`
3. `onboarding.sql`
4. `commerce.sql`
5. `checkout-hardening.sql`

Then put the **public** Supabase Project URL and **public anon key** into root `config.js`.

Never put these values in browser code or GitHub:

- Supabase service role key
- Payment provider secret
- Webhook signing secret
- Private key
- Database password

## Current live flows after setup

### Merchant
Magic Link → Merchant onboarding → Store → Product → Commerce Manager

### SalePage
Commerce Manager → Publish Store + SalePage → `sale.html?store=<store_slug>&page=<page_slug>` → Customer Checkout → `orders` + `order_items` → `PENDING`

### Payment Link
Commerce Manager → Payment Link → `pay.html?link=<slug>` → Customer details → Order record → `PENDING`

## Stock rule

`checkout-hardening.sql` replaces the first checkout function so an anonymous `PENDING` order does **not** decrement stock. Stock mutation must happen in the trusted payment-confirmation flow or through a proper reservation system.

## Payment rule

Neither `sale.html` nor `pay.html` can mark a payment as `PAID`.

Only a trusted backend receiving a verified Payment Provider webhook may write authoritative payment state.

## Before public production traffic

The anonymous checkout RPCs are intentionally minimal for development. Before production, add:

- Cloudflare Turnstile or equivalent bot protection
- API / edge rate limiting
- order abuse detection
- idempotency key for checkout submissions
- inventory reservation / expiry logic
- server-side payment intent creation
- signed provider webhook verification

Do not treat this V1 public checkout as production-grade payment processing until those controls are enabled.
