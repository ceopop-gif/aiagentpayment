# AnnyPay Database + Backoffice — Install Order

Run in Supabase SQL Editor in this exact order:

1. `schema.sql`
2. `policies.sql`
3. `onboarding.sql`
4. `commerce.sql`
5. `checkout-hardening.sql`
6. `backoffice.sql`
7. `secrets.sql`
8. `billing.sql`
9. `frontend-bridge.sql`
10. `payment-fact.sql`
11. `payouts.sql`
12. `store-balance-ledger.sql`
13. `store-balance-functions.sql`

## Server secrets

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ANNYPAY_MASTER_KEY
AI_GATEWAY_URL
AI_GATEWAY_API_KEY
AI_MODEL
BILLING_PROVIDER
PAYMENT_* provider variables
```

For the optional normalized HMAC payout adapter:

```text
PAYOUT_ADAPTER_TYPE=hmac-http
PAYOUT_PROVIDER=<provider-name>
PAYOUT_API_BASE_URL=https://...
PAYOUT_API_KEY=...
PAYOUT_WEBHOOK_SECRET=...
PAYOUT_VERIFY_ACCOUNT_PATH=/beneficiaries/verify
PAYOUT_CREATE_PATH=/payouts
PAYOUT_STATUS_PATH=/payouts/{id}
PAYOUT_SIGNATURE_HEADER=x-signature
```

No payout provider is active unless explicitly configured. Never put service-role keys, master keys, provider secrets, webhook secrets, or full bank account numbers in Browser/GitHub.

## Important pages

```text
/index.html            Merchant Login / Home
/backoffice.html       AI Backoffice
/billing.html          Membership + AI Tokens
/payouts.html          Store Balance + Payout Accounts + Withdrawals
/commerce-admin.html   SalePage + Payment Link Builder
/store.html            Public Storefront
/sale.html             Public SalePage / Checkout
/pay.html              Public Payment Link
```

## Core APIs

```text
GET  /api/health
POST /api/ai/command

GET  /api/payout/balance?merchantId=...&storeId=...
GET  /api/payout/accounts?merchantId=...&storeId=...
POST /api/payout/accounts
POST /api/payout/accounts/verify
POST /api/payout/accounts/default
GET  /api/withdrawals?merchantId=...&storeId=...
POST /api/withdrawals
POST /api/withdrawals/submit
POST /api/webhooks/payout/:provider

POST /api/webhooks/in/:provider
POST /api/webhooks/out
```

## One Database / Store Isolation

All frontoffice and backoffice modules use the same PostgreSQL/Supabase database. Every store is separated by `store_id`, every Merchant by `merchant_id`, and RLS/backend authorization prevents cross-merchant reads.

## Payment Fact

Every generated QR/payment has one self-describing `payment_transactions` row containing the immutable store/order/product/amount/condition snapshot. Provider webhook can locate the transaction by `provider_transaction_id` or `payment_ref` without re-querying Product/Store context.

## Store Money Flow

```text
Customer Payment
→ Verified payment.paid webhook
→ Payment Transaction = PAID
→ idempotent store balance credit
→ pending_balance
→ Hold period
→ available_balance
→ Merchant selects verified payout account
→ Withdrawal snapshot
→ Atomic reserve: available → reserved
→ Risk PASS
→ Payout Provider
→ PROCESSING
→ Verified payout.paid webhook / authoritative provider response
→ reserved decreases
→ total_paid_out increases
```

If Provider returns `FAILED/REJECTED/CANCELLED`:

```text
reserved → available
```

The release is idempotent, so retrying Provider events cannot return money twice.

## Balance Source of Truth

`store_balances` is the fast current balance row for each store:

```text
pending_balance
available_balance
reserved_balance
total_paid_in
total_fees
total_paid_out
```

`store_balance_ledger` is immutable history. Never recalculate the current withdrawal balance in the Browser by summing Orders or Transactions.

## Payout Accounts

- Maximum 5 registered accounts per Store.
- Full account number is encrypted in Secret Store.
- Browser sees only masked/last-4 data.
- New account = `PENDING_VERIFICATION`.
- Only `ACTIVE + verified_at` account may receive a withdrawal.
- Withdrawal cannot accept an arbitrary bank account number.
- Destination + amount + fee + net + currency are immutable after request creation.

## Risk / Policy

Per-store `store_payout_policies` supports:

```text
hold_minutes
min_withdrawal
max_withdrawal_per_request
daily_withdrawal_limit
manual_review_above
status
```

If a request hits manual-review policy it remains `REVIEWING` and cannot be submitted to Provider until trusted operations approval is implemented.

## Authority Rules

Browser and AI cannot mark any of these as final `PAID`:

- Commerce payment
- Subscription invoice
- Token purchase
- Withdrawal

Final status requires verified Provider/bank confirmation or a trusted reconciliation path.

## Production checklist

Before real money production, configure and test end-to-end:

- concrete Payment Provider adapter
- concrete Payout/Bank Provider adapter
- payout account ownership verification
- signed raw-body webhook verification
- risk/AML rules and operational review
- refund/chargeback balance reversal
- provider reconciliation
- idempotency and replay tests
- rate limits and fraud controls
- queue/worker for webhook/payout jobs
- audit/alerts/backups
