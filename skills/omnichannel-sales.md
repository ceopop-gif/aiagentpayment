# AnyPay Omnichannel AI Sales Skill

## Purpose

AnyPay ต้องสามารถรับบทสนทนาการขายจาก Messaging API หลายช่องทางเข้าสู่ Unified Inbox เดียว แล้วให้ AI Sales Agent ช่วยตอบ แนะนำสินค้า ส่ง SalePage / Checkout / Payment Link และบันทึก Conversion กลับไปยัง Conversation เดิม

## Supported adapter targets

### Tier 1
- LINE Official Account — LINE Messaging API
- Facebook Page Messenger — Messenger Platform / Meta Graph API
- Instagram Direct Messaging — Instagram Messaging API for eligible professional accounts
- WhatsApp Business — WhatsApp Business Platform / Cloud API
- Telegram — Bot API
- AnyPay Web Chat — first-party widget/API

### Tier 2 / Future Adapter
รองรับเพิ่ม Provider ใหม่ได้เมื่อมี Official API และ Account permission ที่ถูกต้อง เช่น WeChat/WeCom หรือช่องทาง Business Messaging อื่น โดยต้องทำผ่าน Channel Adapter เดียวกัน ห้ามเขียน business logic ผูกกับ provider โดยตรง

## Architecture

```text
Customer
  ↓
LINE / Facebook / Instagram / WhatsApp / Telegram / Web Chat
  ↓
Provider Webhook
  ↓
Signature / Verification Check
  ↓
Channel Adapter
  ↓
Normalize Message
  ↓
Omni Contact + Identity
  ↓
Omni Conversation + Message History
  ↓
AnyPay AI Sales Agent
  ↓
OFF / DRAFT / AUTO mode
  ↓
Product Recommendation / SalePage / Checkout / Payment Link
  ↓
Provider Send API
  ↓
Customer
```

## AI Modes

- `OFF` — เก็บข้อความเข้า Unified Inbox แต่ AI ไม่ตอบ
- `DRAFT` — AI ร่างคำตอบ Merchant/Staff ต้องกดส่ง
- `AUTO` — AI ตอบอัตโนมัติภายใต้ Sales Policy และ Channel Policy

Default สำหรับ Channel ใหม่ต้องเป็น `DRAFT` จน Merchant ทดสอบและอนุมัติ

## Sales Conversation Memory

AI ต้องรู้ Context ต่อ Conversation:

```yaml
merchant_id:
store_id:
channel_id:
contact_id:
conversation_id:
provider:
customer_intent:
sales_stage:
recommended_products:
last_salepage:
last_checkout:
last_payment_link:
payment_status:
needs_human:
```

Sales Stage:

```text
NEW
→ QUALIFYING
→ RECOMMENDED
→ CHECKOUT_SENT
→ PAYMENT_PENDING
→ PAID
```

`PAID` ต้องเปลี่ยนจาก verified payment event เท่านั้น ไม่ใช่คำพูดของลูกค้าหรือ AI

## AI Sales Rules

1. ใช้ข้อมูลสินค้า ราคา Stock Promotion และ Claim จาก Database/ข้อมูล Merchant เท่านั้น
2. ห้ามสร้างรีวิวปลอม การรับรองปลอม หรือสรรพคุณที่ไม่มีหลักฐาน
3. ถ้าลูกค้าพร้อมซื้อ ให้สร้าง/เลือก SalePage หรือ Checkout/Payment Link ที่ผูก `conversation_id` และ `channel_id`
4. ส่งลิงก์กลับไปยังช่องทางต้นทาง
5. เมื่อ Payment Provider ยืนยัน `PAID` ให้เปลี่ยน Sales Stage เป็น `PAID` และสามารถแจ้งลูกค้ากลับช่องทางเดิม
6. Complaint, Refund dispute, Suspicious payment, Sensitive account change → `needs_human=true`
7. ห้ามขอ Password, OTP, CVV, Bank password หรือ Secret ผ่าน Chat
8. ต้องเคารพ messaging window, template/message policy และ permission ของแต่ละ Provider

## Unified Inbox UX

ทุกช่องทางต้องแสดงในหน้า Chat ของ AnyPay ไม่เปิด Dashboard แยก

Conversation header แสดง:
- Provider icon
- Customer name
- Store
- AI mode
- Sales stage
- Assigned staff

ใน Chat สามารถพิมพ์คำสั่ง เช่น:

- `ตอบลูกค้าคนนี้แบบสุภาพและแนะนำสินค้าที่เหมาะที่สุด`
- `ส่ง SalePage กาแฟ 590 บาทให้ลูกค้าคนนี้`
- `สร้าง Payment Link 1,500 บาทแล้วส่งใน LINE`
- `หยุด AI ตอบแชตนี้ ให้พนักงานรับต่อ`
- `สรุปว่าลูกค้าคนนี้สนใจอะไร`

## Channel Connection

Merchant สามารถสั่ง:

`เชื่อม LINE OA ของร้านนี้`

AnyPay ต้องตอบใน Chat ด้วย Connection Wizard ที่ขอเฉพาะค่าที่จำเป็น และส่ง Secret ไป trusted backend เท่านั้น

Secret ห้ามเก็บใน Browser, localStorage, source code หรือ GitHub

## Webhook Security

- LINE: verify `x-line-signature`
- Meta channels: verify webhook challenge and `x-hub-signature-256`
- Telegram: validate configured webhook secret token
- Web Chat: use AnyPay signed session / anti-abuse control

Webhook processing ต้อง idempotent โดยใช้ provider message/event id

## Attribution

ทุก SalePage / Order / Payment ที่มาจาก Conversation ต้องเก็บ:

```text
channel_id
conversation_id
contact_id
source_message_id
salepage_id
order_id
payment_transaction_id
```

เพื่อรายงานว่า Channel และ AI Conversation ใดสร้างยอดขายจริง
