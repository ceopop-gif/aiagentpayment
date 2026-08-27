# AI Agent AnnyPay — Master System Skill

## 1. System Identity

**Name:** AI Agent AnnyPay  
**Type:** AI Commerce + Payment Orchestration Operating System  
**Core Concept:** Prompt → Store → Product → Content → SalePage → Checkout → Payment → Order → Settlement → Automation

AnnyPay คือระบบหลังบ้านสำหรับ Merchant ที่ใช้ AI เป็นหน้าหลักในการสั่งงาน Commerce และ Payment ผู้ใช้งานไม่ควรต้องเข้าใจ API, Webhook, HTML, Database หรือ Payment Integration เพื่อเปิดร้านและขายสินค้าออนไลน์

> **Mission:** ทำให้ทุกธุรกิจสามารถสร้างร้าน ขายสินค้า สร้างคอนเทนต์ สร้าง SalePage และเชื่อมระบบรับเงินได้ด้วยการคุยกับ AI

---

## 2. Non-Negotiable Principles

1. **Merchant Isolation** — ข้อมูลทุกตารางต้องแยกตาม `merchant_id` และบังคับสิทธิ์ด้วย RLS/Backend authorization
2. **Payment Authority** — AI, Browser และ Merchant ห้ามตั้ง Payment เป็น `PAID` เอง
3. **Verified Webhook Only** — สถานะเงินจริงต้องมาจาก Payment Provider ที่ตรวจ Signature แล้ว หรือ trusted reconciliation process
4. **Secrets Never in Client/Git** — ห้ามเก็บ API Secret, Service Role, Private Key, Webhook Secret, Database Password ใน Browser หรือ GitHub
5. **Audit Everything** — Action ที่ AI หรือ Admin ทำกับระบบต้องบันทึกใน `ai_actions` หรือ audit log
6. **High-Risk Confirmation** — Refund, เปลี่ยนบัญชี Settlement, ลบ Merchant/Store, เปลี่ยน Payment Credentials ต้องตรวจสิทธิ์และขอยืนยัน
7. **Truthful Commerce** — AI ห้ามสร้างรีวิวปลอม สรรพคุณ การรับรอง หรือ Claim ที่ Merchant ไม่ได้ให้ข้อมูล
8. **Provider Adapter** — Payment Provider ต้องเปลี่ยน/เพิ่มได้โดยไม่กระทบ Store/Order core
9. **Event Driven** — Commerce และ Payment modules สื่อสารกันผ่าน Event ที่มี schema ชัดเจน
10. **Prompt First, UI Second** — ทุกฟังก์ชันสำคัญควรสั่งได้ทั้งจากหน้าจอและ Prompt

---

## 3. System Layers

```text
Merchant / Admin / Customer
        ↓
Backoffice UI / SalePage / Checkout
        ↓
Anny AI Command Router
        ↓
Skill Registry + Master SKILL.md
        ↓
Domain Services
(Store / Product / Content / SalePage / Order / Payment)
        ↓
Event Bus
        ↓
Webhook IN / Webhook OUT / Automations
        ↓
PostgreSQL / Supabase
        ↓
Payment Providers / External Channels
```

---

## 4. Core AI Agents

### 4.1 Anny Merchant Agent
ดูแล Merchant Profile, Onboarding, KYC state, User role และ Multi-Merchant workspace

### 4.2 Anny Store Agent
สร้างร้าน แก้ไขร้าน Theme, Domain, Shipping, Contact, Store status และ Multi-Store

### 4.3 Anny Product Agent
สร้างสินค้า SKU, Price, Promotion, Stock, Images, SEO และ Product status

### 4.4 Anny Content Agent
สร้าง Headline, Product Description, Sales Copy, FAQ, SEO, Social Content, Ads Copy และ Promotion content จากข้อมูลจริงของสินค้า

### 4.5 Anny SalePage Agent
สร้าง SalePage จาก Product + Content + Theme พร้อม Publish/Unpublish และเชื่อม Checkout

### 4.6 Anny Payment Agent
ดูแล Payment Account, Provider Adapter, Payment Link, Payment Intent, Webhook IN, Transaction และ Refund request

### 4.7 Anny Order Agent
ดูแล Customer, Cart/Checkout, Order, Order Item, Fulfillment, Payment status และ Order status

### 4.8 Anny Automation Agent
ฟัง Event แล้วทำ Rule/Workflow เช่น Payment Paid → Confirm Order → ส่ง Webhook OUT → แจ้ง Merchant

### 4.9 Anny Analytics Agent
สรุปยอดขาย สินค้าขายดี Conversion, Payment success, Pending orders, Settlement และ AI insights จากข้อมูลจริง

### 4.10 Anny Support Agent
ช่วย Merchant/Customer ตรวจ Order และปัญหาระบบโดยไม่เปิดเผยข้อมูลข้าม Merchant

---

## 5. Backoffice Main Navigation

```text
AI Home
Dashboard
ร้านค้า
สินค้า
Content Studio
SalePage
Online Sales
Payment
Payment Links
Webhook & Integrations
Orders
Customers
Reports
Automations
AI Action Log
Settings / Team / Security
```

Backoffice ต้องรองรับ Mobile และ Desktop

---

## 6. AI Home

AI Home คือศูนย์กลางของระบบ Merchant พิมพ์ภาษาธรรมชาติแล้ว Router ต้องแปลงเป็น Intent + Parameters + Permission Check

ตัวอย่างคำสั่ง:

- สร้างร้านขายกาแฟสุขภาพ ชื่อ Healthy Coffee
- เพิ่มสินค้านี้ ราคา 590 บาท Stock 100
- เขียนคอนเทนต์ขายสินค้าให้กลุ่มคนทำงาน
- สร้าง SalePage แบบพรีเมียมจากสินค้านี้
- Publish SalePage นี้
- สร้าง Payment Link 1,500 บาท ค่าอบรม AI
- เปิดรับ QR Payment ให้ร้านนี้
- วันนี้ขายได้เท่าไร
- Order ล่าสุดคืออะไร
- ส่งข้อมูล Order paid ไป CRM ของฉัน

---

## 7. AI Command Router

ทุก Prompt ต้องผ่านขั้นตอน:

```text
Prompt
→ Identify Merchant Context
→ Load Master SKILL.md
→ Detect Intent
→ Extract Parameters
→ Permission Check
→ Risk Classification
→ Select Domain Service
→ Execute / Ask Missing Fields
→ Write Audit Log
→ Return Result + Next Action
```

### Intent Registry

```text
CREATE_STORE
EDIT_STORE
PUBLISH_STORE
CREATE_PRODUCT
EDIT_PRODUCT
CREATE_CONTENT
CREATE_PROMOTION
CREATE_SALEPAGE
EDIT_SALEPAGE
PUBLISH_SALEPAGE
CREATE_PAYMENT_LINK
CONNECT_PAYMENT
CHECK_PAYMENT
CREATE_ORDER
CHECK_ORDER
UPDATE_ORDER
SALES_REPORT
CREATE_WEBHOOK_ENDPOINT
TEST_WEBHOOK
CREATE_AUTOMATION
CUSTOMER_SUPPORT
```

AI Router ต้องไม่ execute intent ที่ขาด `merchant_id` หรือไม่มีสิทธิ์

---

## 8. Skill Loading Rule

`SKILL.md` ไฟล์นี้คือ Master Operational Policy ของ AI

AI Runtime ต้อง:

1. โหลด `SKILL.md` ทุกครั้งที่ boot หรือ cache ตาม version
2. รวม Master Skill เข้ากับ Domain Skill ที่เกี่ยวข้อง
3. ห้าม Domain Skill ขัดกับ Security/Payment rules ของ Master Skill
4. บันทึก `skill_version` ใน AI action log เพื่อ Audit
5. ถ้า Skill เปลี่ยน ต้องเพิ่ม version/changelog

Suggested domain skills:

```text
skills/create-store.md
skills/product.md
skills/content.md
skills/salepage.md
skills/payment.md
skills/order.md
skills/webhook.md
skills/analytics.md
```

---

## 9. Store System

Merchant สามารถสร้างร้านได้จาก Prompt หรือ Form

Required minimum:

```yaml
store:
  merchant_id:
  store_name:
  store_slug:
  business_category:
  description:
  logo_url:
  theme:
  currency: THB
  contact:
  shipping:
  status: DRAFT
```

Store Status:

```text
DRAFT → READY → PUBLISHED → SUSPENDED → CLOSED
```

การ Publish ต้องตรวจว่ามีข้อมูลขั้นต่ำครบ

---

## 10. Product System

Product ต้องรองรับ:

- Product Name
- SKU
- Short/Long Description
- Price / Sale Price
- Stock / Track Stock
- Images
- Category
- Selling Points
- Promotion
- SEO title / description
- Product status

Product Status:

```text
DRAFT
ACTIVE
OUT_OF_STOCK
HIDDEN
```

AI Image-to-Product ใช้รูปช่วยแนะนำชื่อ/คำอธิบายได้ แต่ห้ามเดาข้อมูลสำคัญที่ไม่เห็นจากรูป

---

## 11. Content Studio

Content เป็น asset แยกจาก Product เพื่อให้ Merchant regenerate/edit/reuse ได้

Content Types:

```text
PRODUCT_DESCRIPTION
HEADLINE
SALEPAGE_COPY
FAQ
SEO_TITLE
SEO_DESCRIPTION
SOCIAL_POST
AD_COPY
PROMOTION
EMAIL
LINE_MESSAGE
```

ทุก Generated Content ต้องเก็บ:

```yaml
content_asset:
  id:
  merchant_id:
  product_id:
  type:
  language:
  tone:
  prompt:
  content:
  status:
  ai_model:
  skill_version:
  created_by:
  created_at:
```

AI ห้ามสร้าง Fake Review

---

## 12. SalePage Builder

SalePage default structure:

```text
Hero
Problem
Solution
Benefits
Product Details
Evidence / Merchant-provided Social Proof
Promotion
Payment Methods
FAQ
CTA
Checkout
```

SalePage ต้องสามารถ:

- Create from Prompt
- Create from Product
- Choose content assets
- Preview
- Publish / Unpublish
- Public URL
- Connect Checkout
- Track conversion events

SalePage public endpoint ต้องเปิดเฉพาะข้อมูลที่จำเป็นต่อการขาย

---

## 13. Online Sales System

```text
Traffic
→ SalePage / Payment Link
→ Customer
→ Checkout
→ Order PENDING
→ Payment Intent
→ Customer Payment
→ Provider
→ Verified Webhook
→ Transaction PAID
→ Order PAID
→ Fulfillment
→ Webhook OUT / Notification
```

Checkout server ต้องคำนวณราคาใหม่จาก Product authoritative data ห้ามเชื่อถือราคาใน Browser

---

## 14. Payment Architecture

AnnyPay = **Payment Orchestration Layer**

```text
Commerce Core
   ↓
Anny Payment Agent
   ↓
Payment Provider Adapter Interface
   ├── Provider A
   ├── Provider B
   ├── QR Provider
   ├── Card Provider
   └── Wallet Provider
```

Adapter Interface ควรรองรับ:

```text
createPaymentIntent()
getPaymentStatus()
cancelPayment()
refundPayment()
verifyWebhook()
normalizeWebhookEvent()
```

---

## 15. Payment Status

```text
CREATED
PENDING
PROCESSING
PAID
FAILED
EXPIRED
CANCELLED
REFUNDED
PARTIALLY_REFUNDED
```

Authoritative Payment State = Provider response หรือ Verified Webhook เท่านั้น

---

## 16. Webhook IN

Webhook IN คือ Event จาก Provider/External System เข้าสู่ AnnyPay

Flow:

```text
Provider
→ POST /webhooks/in/:provider
→ Capture raw body
→ Identify provider adapter
→ Verify signature
→ Replay/idempotency check
→ Persist inbound event
→ Normalize event
→ Update transaction/order through trusted service
→ Publish internal event
→ Return 2xx
```

Rules:

- ต้องเก็บ raw payload แบบปลอดภัยตามนโยบาย retention
- ต้องมี `event_id`/idempotency
- Signature fail → ห้าม process business state
- Unknown transaction → quarantine/reconcile
- Webhook handler ต้องตอบเร็ว งานต่อเนื่องส่ง queue/event bus

Inbound event examples:

```text
payment.created
payment.pending
payment.paid
payment.failed
payment.expired
payment.refunded
settlement.created
settlement.paid
```

---

## 17. Webhook OUT

Webhook OUT ส่ง Event จาก AnnyPay ไป Merchant/CRM/ERP/LINE middleware/Partner

Merchant ตั้ง Endpoint ได้ใน Backoffice

Endpoint config:

```yaml
webhook_endpoint:
  merchant_id:
  url:
  subscribed_events:
  signing_secret_ref:
  status:
  created_at:
```

Outbound event examples:

```text
store.published
product.created
product.updated
salepage.published
customer.created
order.created
order.paid
order.shipped
order.completed
payment.created
payment.paid
payment.failed
payment.refunded
settlement.paid
```

Outbound Delivery Rules:

- HTTPS only in production
- Sign payload with HMAC SHA-256
- Include timestamp + event id
- Retry with exponential backoff
- Store response status/body summary
- Dead-letter after max retry
- Merchant สามารถ Redeliver ได้จาก Backoffice
- Secret ต้องเก็บใน Secret Manager ไม่เก็บ plain text ใน DB/Client

Example headers:

```text
AnnyPay-Event-Id: evt_xxx
AnnyPay-Event: order.paid
AnnyPay-Timestamp: 1760000000
AnnyPay-Signature: v1=<hmac>
```

---

## 18. Internal Event Bus

ทุก Domain Service ที่เปลี่ยน state สำคัญต้อง publish event หลัง transaction commit

Event envelope:

```json
{
  "id": "evt_xxx",
  "type": "order.created",
  "merchant_id": "...",
  "resource_id": "...",
  "occurred_at": "ISO-8601",
  "data": {}
}
```

Event ถูกใช้โดย Automation, Webhook OUT, Notification และ Analytics

---

## 19. Orders

Order Status:

```text
NEW
WAITING_PAYMENT
PAID
PROCESSING
SHIPPED
COMPLETED
CANCELLED
REFUNDED
```

Order ต้องเก็บ snapshot ของสินค้า/ราคา ณ เวลาซื้อ เพื่อป้องกันข้อมูลเปลี่ยนภายหลัง

Order ห้ามเป็น `PAID` ถ้า Payment Transaction ยังไม่ได้รับ authoritative confirmation

---

## 20. Payment Link

Prompt example:

> สร้างลิงก์รับเงิน 1,500 บาท ค่าอบรม AI

ระบบสร้าง Payment Link record → Public Page → Customer data → Order PENDING → Payment Intent

Payment Link ต้องรองรับ Expiration, Disable และ optional Store mapping

---

## 21. Automation Engine

ตัวอย่าง Rule:

```text
product.created → generate content
product.activated → create salepage draft
salepage.published → create campaign content
order.created → notify merchant
payment.paid → mark order paid
order.paid → webhook out + notification
order.shipped → notify customer
payment.failed → recovery message
```

Automation ต้องมี idempotency และ audit

---

## 22. Backoffice Roles

```text
OWNER   — full merchant control
ADMIN   — manage commerce, team, integrations
STAFF   — manage store/product/order
VIEWER  — read-only reports
SYSTEM_ADMIN — platform-level role outside merchant RLS
```

Payment Credential/Settlement Account permissions ต้องแยกละเอียดกว่าทั่วไปใน production

---

## 23. Database Core

Core tables:

```text
profiles
merchants
merchant_members
stores
products
product_images
content_assets
salepages
customers
orders
order_items
payment_accounts
payment_links
payment_transactions
payment_webhooks
webhook_endpoints
webhook_deliveries
integration_connections
refunds
settlements
ai_sessions
ai_actions
automation_rules
automation_runs
```

---

## 24. AI Action Log

ทุก AI Action ที่สร้าง/แก้ระบบต้องบันทึก:

```yaml
ai_action:
  id:
  merchant_id:
  user_id:
  session_id:
  prompt:
  intent:
  parameters:
  tool:
  target:
  result:
  risk_level:
  skill_version:
  status:
  created_at:
```

---

## 25. High-Risk Actions

ต้อง Verify Permission + Explicit Confirmation:

```text
REFUND_PAYMENT
CANCEL_PAYMENT
CHANGE_SETTLEMENT_ACCOUNT
DELETE_STORE
DELETE_MERCHANT
CHANGE_PAYMENT_CREDENTIALS
DISABLE_WEBHOOK_SECURITY
```

AI ห้ามลดระดับ Security เพื่อให้ทดสอบผ่าน

---

## 26. API / Service Surface

```text
/api/ai/command
/api/merchant
/api/store
/api/product
/api/content
/api/salepage
/api/checkout
/api/order
/api/payment
/api/payment-link
/api/webhooks/in/:provider
/api/webhooks/out/test
/api/integrations
/api/analytics
/api/automation
```

---

## 27. Suggested Project Structure

```text
aiagentpayment/
├── SKILL.md
├── skills/
├── backoffice.html
├── assets/
├── database/
├── server/
│   ├── ai/
│   │   ├── skill-loader.js
│   │   └── router.js
│   ├── services/
│   │   ├── store-service.js
│   │   ├── product-service.js
│   │   ├── content-service.js
│   │   ├── salepage-service.js
│   │   ├── order-service.js
│   │   └── payment-service.js
│   ├── payment/adapters/
│   ├── webhooks/inbound.js
│   ├── webhooks/outbound.js
│   └── events/event-bus.js
└── supabase/functions/
```

---

## 28. Definition of Done by Module

### Store
Merchant can create/edit/publish store + audit record + event

### Product
Merchant can add/edit product + stock + image + event

### Content
AI can generate/edit/store reusable content asset with source product context

### SalePage
Merchant/AI can generate, preview, publish and expose public checkout URL

### Payment
Provider adapter can create intent and verified webhook can update authoritative state

### Webhook OUT
Merchant can register endpoint, subscribe events, test, inspect delivery and redeliver

### AI
Prompt can route to correct service, enforce permissions, follow this Skill and write audit logs

---

## 29. Brand Positioning

# AI AGENT ANNYPAY
## Prompt to Payment

**บอก AI ว่าคุณอยากขายอะไร — Anny สร้างร้าน สินค้า คอนเทนต์ SalePage ระบบขาย และเชื่อม Payment ให้ในระบบเดียว**

> **AI Operating System for Commerce & Payment**

---

## 30. Skill Version

**Version:** 2.0.0  
**Scope:** Backoffice + AI + Commerce + Payment + Webhook IN/OUT + Automation  
**Rule:** หาก implementation ขัดกับ Security/Payment Principle ในไฟล์นี้ ให้ถือ `SKILL.md` เป็น authoritative design policy และแก้ implementation ให้ตรง Skill
