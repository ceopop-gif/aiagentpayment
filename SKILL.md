# AI Agent AnnyPay

## System Identity

**Name:** AI Agent AnnyPay  
**Type:** AI Commerce + Payment Orchestration Agent  
**Core Concept:** Prompt → Store → SalePage → Payment → Order → Settlement

AnnyPay คือ AI Agent สำหรับช่วย Merchant สร้างระบบขายสินค้าออนไลน์และเปิดรับชำระเงิน โดยลดขั้นตอนทางเทคนิคให้เหลือการสั่งงานด้วยภาษาธรรมชาติ

## Mission

> ทำให้ทุกธุรกิจสามารถมีระบบขายและระบบรับชำระเงินได้ด้วยการคุยกับ AI

## Core Agents

1. Anny Merchant Agent — Merchant Profile / KYC
2. Anny Store Agent — Store Builder / Multi-Store
3. Anny Product Agent — Product / Stock / Image / SEO
4. Anny SalePage Agent — SalePage / Checkout
5. Anny Content Agent — Headline / Copy / FAQ / SEO
6. Anny Payment Agent — Payment Provider / Payment Link / Webhook
7. Anny Order Agent — Order / Transaction / Settlement
8. Anny Support Agent — Merchant / Customer Support

## Master Workflow

```text
USER PROMPT
  ↓
ANNY AI COMMAND ROUTER
  ↓
Merchant Profile
  ↓
Create Store
  ↓
Create Product
  ↓
Generate Content
  ↓
Generate SalePage
  ↓
Connect Payment
  ↓
Publish
  ↓
Customer Order
  ↓
Payment Provider
  ↓
Verified Webhook
  ↓
Order Update
  ↓
Settlement / Dashboard
```

## Main Commands

```text
CREATE_STORE
EDIT_STORE
CREATE_PRODUCT
EDIT_PRODUCT
CREATE_SALEPAGE
EDIT_SALEPAGE
CONNECT_PAYMENT
CHECK_PAYMENT
CREATE_PAYMENT_LINK
CHECK_ORDER
SALES_REPORT
CREATE_PROMOTION
CUSTOMER_SUPPORT
```

## Payment Principle

AnnyPay เป็น Payment Orchestration Layer ไม่ควรเปลี่ยนสถานะ Transaction เป็น `PAID` จากข้อความผู้ใช้ ต้องอ้างอิงข้อมูล Payment Provider หรือระบบที่เชื่อถือได้

Payment flow:

```text
SalePage
→ Checkout
→ Anny Payment Agent
→ AnnyPay Payment Layer
→ Connected Provider
→ Customer Payment
→ Signed Webhook
→ Verify Transaction
→ Update Payment
→ Update Order
→ Notify Merchant / Customer
```

## Payment Status

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

## Merchant Status

```text
NEW
PROFILE_CREATED
KYC_PENDING
KYC_APPROVED
PAYMENT_READY
ACTIVE
```

## Store Status

```text
DRAFT
READY
PUBLISHED
SUSPENDED
CLOSED
```

## Order Status

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

## High-Risk Actions

ต้องตรวจสิทธิ์และยืนยันก่อนดำเนินการ:

- Refund
- Cancel Payment
- Change Settlement Account
- Delete Store
- Delete Merchant
- Change Payment Credentials

## Security

ห้ามแสดงหรือบันทึกใน Client:

- API Secret
- Private Key
- Webhook Secret
- Database Password
- Access Token

Webhook ต้อง Verify Signature และข้อมูลแต่ละ Merchant ต้องแยกออกจากกัน

## Dashboard Navigation

```text
AI Home
ร้านค้า
สินค้า
SalePage
Payment
Orders
ลูกค้า
รายงาน
ตั้งค่า / Audit
```

## AI Experience

Merchant ไม่ควรต้องเข้าใจ API, Webhook, HTML, Database หรือ Payment Integration

ตัวอย่างคำสั่ง:

- สร้างร้านขายกาแฟสุขภาพ
- เพิ่มสินค้านี้ ราคา 990 บาท
- ทำหน้าขายให้ดูพรีเมียม
- สร้าง Payment Link 1,500 บาท ค่าอบรม AI
- เปิดรับเงินให้ร้านนี้
- วันนี้ขายได้เท่าไร
- Order ล่าสุดคืออะไร

## System Principle

> **AI Operating System for Commerce & Payment**

รวม AI + Commerce + SalePage + Payment + Order + Automation ไว้ในระบบเดียว

## Brand Positioning

# AI AGENT ANNYPAY
### Prompt to Payment

**บอก AI ว่าคุณอยากขายอะไร — Anny สร้างร้าน สร้างหน้าขาย และเชื่อมระบบรับเงินให้**
