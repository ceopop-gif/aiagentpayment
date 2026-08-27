# AnnyPay Payment Fact Setup

Run `database/payment-fact.sql` after the current core migrations (`schema`, `commerce`, `backoffice`, `billing`, `frontend-bridge`).

## Goal
One QR / Payment Intent = one self-describing row in `payment_transactions`.

The row contains merchant/store/order/product/amount/conditions/time/QR/provider context as immutable snapshots. Search, support, webhook handling and reconciliation can read the transaction directly without joining Store/Product/Order tables to reconstruct what was sold.

## Example

```text
payment_ref: AP20260827-1A2B3C4D5E6F
merchant_id: <merchant uuid>
store_id: <store uuid>
store_name_snapshot: Healthy Coffee
order_id: <order uuid>
order_no_snapshot: AN20260827...
product_summary: Healthy Coffee x2
items_snapshot: [{product_id, product_name, quantity, unit_price, line_total}]
subtotal_snapshot: 1180.00
discount_snapshot: 100.00
shipping_snapshot: 0.00
amount: 1080.00
currency: THB
purchase_conditions_snapshot: {...}
requested_at: 2026-08-27T20:30:00+07:00
qr_expires_at: ...
provider: ...
provider_transaction_id: ...
status: PENDING
```

After verified payment webhook, only lifecycle/provider fields change, for example `status`, `fee`, `paid_at`, `raw_provider_data`. Commercial snapshot fields are protected by a database trigger and cannot be rewritten.

## Important
This snapshot does not replace normalized master tables. It is the immutable transaction fact at the moment QR/payment is created. Current product/store data still lives in the normal Store/Product tables.
