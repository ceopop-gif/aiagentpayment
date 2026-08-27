# AnnyPay AI Commerce + Payment

**AI Operating System for Commerce & Payment**

**Flow:** Prompt → Store → Product → Content → SalePage → Checkout → Payment → Store Balance → Withdrawal → Settlement / Automation → Unified Audit

## Main pages

- `index.html` — Merchant Login / Onboarding
- `backoffice.html` — Full AI Backoffice
- `activity-logs.html` — Activity Logs + Login Sessions
- `billing.html` — Membership + AI Token Wallet
- `payouts.html` — Store Balance + Payout Accounts + Withdrawals
- `commerce-admin.html` — SalePage + Payment Link Builder
- `store.html` — Public Storefront
- `sale.html` — Public SalePage / Checkout
- `pay.html` — Public Payment Link

## Unified Activity / Security Logs

AnnyPay uses one append-only log stream covering:

```text
Login / Session
Frontend
Backoffice
API
Database changes
AI
Payment
Webhook
Billing
Payout / Withdrawal
System / Security
```

`activity_logs` records what happened, who performed it, time, Merchant/Store, Route, Request ID, Resource, result and sanitized metadata.  
`user_sessions` records login time, last seen, logout and active status.

Every API request receives `x-request-id`. The browser uses `x-annypay-session` so Page, Form, API and Database events can be correlated.

Sensitive values are never logged: Password, access token, cookie, service role, API/private key, webhook secret, full bank account number, card number or CVV. IP is stored only as HMAC hash when `LOG_IP_HASH_KEY` is configured.

See `AUDIT_LOGGING.md` and run `database/audit-logs.sql` last.

## One database / Store isolation

All frontoffice and backoffice modules use the same PostgreSQL/Supabase database. Each store has its own `store_id`; payment, balance, membership, AI token wallet, payout accounts, withdrawals and activity logs are linked to that Store.

## Payment Fact

Each QR/payment creates one self-describing `payment_transactions` row with immutable store/order/product/amount/conditions snapshot. Webhook processing can identify the commercial context from that row without joining Store/Product again.

## Store money system

Each store has one current `store_balances` row:

```text
pending_balance
available_balance
reserved_balance
total_paid_in
total_fees
total_paid_out
```

Every movement is written to immutable `store_balance_ledger`.

```text
Verified payment.paid
→ Pending Balance
→ Hold
→ Available Balance
→ Withdrawal Reserve
→ Payout Provider
→ Verified payout.paid
→ Paid Out
```

Provider failure releases Reserved back to Available idempotently.

## Payout accounts

- Maximum 5 registered payout accounts per Store.
- Full account number is encrypted in server Secret Store.
- Browser sees only masked/last-4 data.
- New account = `PENDING_VERIFICATION`.
- Withdrawal is allowed only to `ACTIVE + verified` account.
- Withdrawal destination/amount snapshot cannot be changed after request creation.

## Membership + AI Tokens

Each Store has a monthly subscription and AI token wallet. AI checks active subscription and remaining token balance before generative usage. Purchased token packs are granted only after verified billing payment.

## AI

`SKILL.md` is the Master System Skill. Core Billing, Frontend↔Backoffice Sync, Payment Fact and Unified Audit policies are loaded with domain skills before AI execution.

## Backend

```text
server/
├── ai/
├── services/
├── logging/        Unified structured audit logger
├── payment/
├── payout/
├── webhooks/
├── events/
├── automation/
├── secrets/
├── lib/
└── server.js
```

## Core APIs

```text
GET  /api/health
POST /api/ai/command

POST /api/logs/client
POST /api/logs/auth
GET  /api/logs
GET  /api/sessions

GET  /api/payout/balance
GET  /api/payout/accounts
POST /api/payout/accounts
POST /api/payout/accounts/verify
POST /api/payout/accounts/default
GET  /api/withdrawals
POST /api/withdrawals
POST /api/withdrawals/submit
POST /api/webhooks/payout/:provider

POST /api/webhooks/in/:provider
POST /api/webhooks/out
```

## Database install

Run SQL exactly in the order in `database/INSTALL.md`. `audit-logs.sql` is the final migration so triggers can attach to all modules.

## Start

```bash
npm install
npm start
```

Use `.env.example` for environment names. Real secrets must be stored in the hosting platform secret environment, never in GitHub or client code.

## Authority rule

Browser and AI are never authoritative for final money status. `PAID` payment/withdrawal states require verified provider/bank response or trusted reconciliation.

No real Payment/Payout Provider is enabled by default. Configure a concrete adapter and production credentials before processing real money.

## Repository

Owner: `ceopop-gif`  
Project: `aiagentpayment`
