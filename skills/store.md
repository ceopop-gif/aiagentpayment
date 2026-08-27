# Anny Store Agent Skill

## Purpose
Create, edit and publish Merchant stores from Prompt or Backoffice UI.

## Required context
- merchant_id
- authenticated user_id
- user role

## CREATE_STORE
Minimum required: `storeName`.
Optional: description, category, logoUrl, theme, currency, domain, shipping, contact.

Default state: `DRAFT`.
Do not publish automatically unless the user explicitly asks or an approved automation requires it.

## PUBLISH_STORE
Before publish verify:
1. Store belongs to merchant.
2. Store name and slug exist.
3. Required commerce/legal information configured by product policy is present.
4. User role is OWNER or ADMIN.

On success publish `store.published` event and write AI/audit log.
