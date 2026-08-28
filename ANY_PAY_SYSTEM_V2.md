# AnyPay System V2 — Frontoffice + Backoffice + AI Commerce + Payment

## 1. Product Direction

AnyPay is designed as an **AI Commerce Operating System** with one principle:

> Merchant should not need to learn a complicated dashboard. They should be able to tell AnyPay what they want to do in natural language.

The system is split into two experiences that share the same domain data:

1. **Merchant Frontoffice / AI Workspace** — ChatGPT-style interface for day-to-day business operations.
2. **Platform Backoffice / Admin Control Center** — Platform-level control for Merchant provisioning, risk, payment, channels, AI, audit and reporting.

Public Merchant signup is intentionally postponed in this phase. Merchant accounts are provisioned by Platform Admin first.

---

## 2. System Map

```text
CUSTOMER CHANNELS
LINE OA / Messenger / Instagram / WhatsApp / Telegram / Web Chat
        ↓ Webhook / Official API
OMNICHANNEL MESSAGE ADAPTERS
        ↓ normalized message
AnyPay AI Sales Agent
        ↓
Merchant Chat Workspace
        ↓
Store / Product / SalePage / Checkout
        ↓
Payment Link / Payment Provider
        ↓ verified webhook
Order / Balance / Settlement / Payout
        ↓
Analytics / Attribution / Automation / Audit

PLATFORM ADMIN
        ↓
Admin Control Center
        ↓
Merchant / KYC / Payment / Risk / Channels / AI / Audit
```

---

## 3. Merchant Frontoffice

### 3.1 UX principle

The Merchant UI is a single Chat Workspace. Menu clicks do not navigate to separate dashboards. They inject structured tools/cards into the same conversation.

Main actions:

- Create / edit Store
- Add / edit Product
- Generate Product content
- Generate SalePage
- Generate Payment Link / QR
- Read Orders
- Read Store balance
- Request Withdrawal
- Read Reports
- Open Omnichannel Inbox
- Reply to customers with AI assistance
- Continue previous Chat threads

### 3.2 Context memory

Each conversation should retain:

```text
merchant_id
store_id
conversation_id
active customer/contact
active omni conversation
active product
active SalePage
active order
last payment amount / purpose
intent history
missing parameters
AI proposed next action
```

### 3.3 Chat history

Production tables:

- `ai_conversations`
- `ai_messages`

Browser demo uses LocalStorage only for visualization. Production uses database + authentication + RLS.

### 3.4 Omnichannel Sales Inbox

Customer chat from each supported Official API is normalized into:

- `messaging_channels`
- `omni_contacts`
- `omni_contact_identities`
- `omni_conversations`
- `omni_messages`

Sales stage:

```text
NEW
→ QUALIFYING
→ RECOMMENDED
→ CHECKOUT_SENT
→ PAYMENT_PENDING
→ PAID
```

AI mode can be configured per Channel:

```text
OFF   = staff only
DRAFT = AI suggests; staff confirms
AUTO  = AI may respond within approved policy/guardrails
```

---

## 4. Platform Backoffice

### 4.1 Platform roles

Platform Admin roles must be independent from Merchant roles:

```text
OWNER
ADMIN
FINANCE
RISK
SUPPORT
VIEWER
```

Merchant roles remain:

```text
OWNER
ADMIN
STAFF
VIEWER
```

### 4.2 Admin navigation

```text
Overview
Merchants
Omnichannel Inbox
Commerce
Payment & Transactions
Payout & Withdrawal
Sales Channels
AI & Automations
Reports
Admin Team
Audit Logs
System Settings
```

### 4.3 Manual Merchant provisioning — Phase 1

Admin flow:

```text
Admin
→ Add Merchant
→ Business profile
→ Select/attach existing owner user
→ Merchant Profile
→ OWNER merchant_members
→ Optional first Store
→ Provisioning status
→ KYC
→ Payment onboarding
→ READY
```

Public signup is Phase 2 and should plug into the same provisioning pipeline using `source=PUBLIC_SIGNUP`.

### 4.4 Merchant detail snapshot

Admin should be able to open one Merchant and see:

- Business profile
- Owner / team
- Merchant status
- KYC status
- Payment status
- Plan / billing
- Stores
- Products
- SalePages
- Orders
- Transactions
- Balances / payouts
- Channels
- Customer conversations
- AI usage
- Automations
- Audit trail

Admin can then open **Merchant Workspace** to view the exact Merchant-side experience.

---

## 5. Commerce Domain

### Store

```text
DRAFT → READY → PUBLISHED → SUSPENDED → CLOSED
```

### Product

```text
DRAFT → ACTIVE → OUT_OF_STOCK / HIDDEN
```

### SalePage

```text
DRAFT → PUBLISHED → ARCHIVED
```

### Checkout

Checkout owns customer info, shipping, items, discount, total and selected payment method.

---

## 6. Payment Domain

AnyPay acts as a Payment Orchestration Layer.

```text
SalePage / Payment Link
→ Payment Intent
→ Provider Adapter
→ Provider
→ Customer pays
→ Verified Webhook
→ Transaction state
→ Order state
→ Store Balance
```

Payment state cannot be set to `PAID` by:

- Browser
- Merchant text prompt
- AI model
- unverified webhook

Only a trusted provider response or reconciliation is authoritative.

---

## 7. Store Money / Payout

```text
Verified PAID
→ Pending Balance
→ Hold / Risk
→ Available Balance
→ Withdrawal Reserve
→ Payout Provider
→ Verified payout.paid
→ Paid Out
```

High-risk actions require explicit confirmation and appropriate role:

- Refund
- Change settlement/payout account
- Withdrawal
- Delete Merchant
- Delete Store
- Change Payment credentials
- Suspend Merchant

---

## 8. AI Architecture

```text
User / Customer Message
→ Context Loader
→ Merchant Isolation
→ Intent Classifier
→ Parameter Extraction
→ Missing Field Resolver
→ Permission Check
→ Risk Classification
→ Domain Tool / Service
→ Result
→ Suggested Next Action
→ Audit Log
```

AI must distinguish between:

1. **Read-only answer** — e.g. sales report
2. **Draft/proposal** — content, recommended reply
3. **Low-risk write** — create draft product/store
4. **High-risk action** — withdrawal/refund/payment credential changes

High-risk actions never auto-execute based only on AI output.

---

## 9. Omnichannel Adapter Contract

Every provider adapter should expose a common contract:

```text
verifyWebhook(rawBody, headers)
parseInbound(rawBody)
sendText(conversation, text)
sendMedia(conversation, media)
sendProduct(conversation, product)
sendCheckoutLink(conversation, url)
getProfile(externalUserId)
```

Provider-specific credentials are stored encrypted in Secret Store and referenced by ID from `messaging_channels`.

Initial channel targets:

- LINE OA Messaging API
- Meta Messenger Platform
- Instagram Messaging API
- WhatsApp Business Platform
- Telegram Bot API
- Web Chat

Only channels with official/authorized API access should be activated.

---

## 10. Data Isolation

Every business-domain record must be scoped by `merchant_id` and where relevant `store_id`.

Platform Admin access and Merchant access are separate permission domains.

No Merchant should be able to query another Merchant's:

- chats
- customers
- products
- orders
- transactions
- balance
- channels
- secrets
- audit logs

---

## 11. Audit

Append-only audit should cover:

```text
Login / Session
Frontend
Admin Backoffice
AI
Commerce writes
Payment
Webhook
Omnichannel messages
Channel config
Billing
Payout / Withdrawal
Security / Risk
```

Each event should include when available:

```text
request_id
actor_type
actor_user_id
merchant_id
store_id
conversation_id
channel_id
resource_type
resource_id
event_name
result
sanitized metadata
created_at
```

Secrets and full financial credentials must never be written to audit logs.

---

## 12. Phase Plan

### Phase 1 — Current structure

- Admin manual Merchant creation
- Modern Platform Admin UI
- ChatGPT-style Merchant Workspace
- Shared system model
- Persistent chat schema
- Omnichannel schema/adapters architecture
- Commerce / Payment / Payout architecture

### Phase 2 — Production integration

- Auth + Platform Admin RBAC
- Supabase migrations
- Admin Merchant APIs
- Real Merchant Chat history APIs
- Real Channel webhook adapters
- Real AI Gateway
- Real Payment Provider adapter
- Real Payout Provider adapter

### Phase 3 — Public onboarding

- Merchant signup
- Email / phone verification
- Merchant owner invitation
- KYC upload / review
- Plan selection
- Payment provider onboarding
- First Store wizard

The Phase 3 signup path must reuse the same provisioning states and should not create a second Merchant model.

---

## 13. UX Definition

### Merchant

> "บอก AnyPay ว่าต้องการทำอะไร"

### Platform Admin

> "เห็นทุก Merchant, ความเสี่ยง, Payment, Channels และสถานะระบบจากจุดเดียว"

AnyPay should feel like an intelligent assistant for Merchants and a controlled operating console for Platform Admins.
