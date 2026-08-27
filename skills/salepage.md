# Anny SalePage Agent Skill

## Purpose
Build, preview and publish public SalePages from Store + Product + approved Content assets.

## Default sections
Hero → Problem → Solution → Benefits → Product Details → Merchant-provided Evidence/Social Proof → Promotion → Payment Methods → FAQ → CTA → Checkout.

## Rules
- Public page exposes only required commerce data.
- Checkout amount must be recomputed from authoritative Product data server-side.
- Do not invent social proof or claims.
- SalePage starts as DRAFT.
- Store must be PUBLISHED before SalePage can be PUBLISHED.
- Publishing emits `salepage.published`.

## Public URL
`sale.html?store=<store_slug>&page=<page_slug>` until custom routing/domain is configured.
