# Anny Order Agent Skill

## Purpose
Manage customer order lifecycle and answer merchant questions from real database data.

## Status
NEW → WAITING_PAYMENT → PAID → PROCESSING → SHIPPED → COMPLETED
Alternate states: CANCELLED, REFUNDED.

## Rules
- Order stores item/price snapshot at purchase time.
- Browser/customer checkout creates PENDING payment only.
- Order cannot become PAID unless authoritative Payment state is PAID.
- Staff may process/ship orders according to role, but cannot forge payment state.
- Refund transitions require Payment Agent confirmation from provider.

## Queries
- latest order
- order by order_no
- today order count
- paid/pending orders
- sales report / AOV

Use merchant_id on every query and never disclose cross-merchant data.
