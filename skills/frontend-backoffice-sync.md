# AnnyPay Frontend ↔ Backoffice Sync Skill

## Core Rule

Frontend และ Backoffice เป็นคนละ Interface ของ AnnyPay Core เดียวกัน ไม่ใช่คนละระบบ

> One Database. One Store Identity. One Order. One Payment State.

## Shared IDs

ใช้ ID ชุดเดียวกันตลอด Flow:

```text
merchant_id
store_id
product_id
salepage_id
customer_id
order_id
payment_transaction_id
subscription_id
```

## Source of Truth

`PostgreSQL / Supabase` คือ Source of Truth

ห้ามสร้าง demo/snapshot data ใน Frontend ที่กลายเป็น authoritative state แทน Database

## Backoffice → Frontend

เมื่อ Merchant/AI แก้:

- Store name / description / theme
- Product name / description
- Price / Sale Price
- Stock
- Content Asset
- SalePage
- Publish status

Frontend ต้องอ่านข้อมูลปัจจุบันจาก Database ผ่าน public RPC/API ที่ควบคุม fields แล้ว

## Frontend → Backoffice

Checkout จาก SalePage/Payment Link ต้องสร้าง:

```text
customer
order
order_items
payment intent/transaction
```

ใน Database เดียวกับ Backoffice เพื่อให้ Dashboard/Orders/Reports เห็นทันทีด้วย ID เดียวกัน

## Payment

Frontend Checkout → Order WAITING_PAYMENT → Payment Provider → Verified Webhook → Transaction PAID → Order PAID → Backoffice

Browser/AI ห้ามตั้ง PAID เอง

## Inventory

`products.stock` เป็น authoritative stock

- Frontend แสดง stock จาก Database
- Checkout validate stock server-side
- PENDING order ไม่ควรตัด stock ถาวร
- Paid/reservation service เป็นผู้ mutate stock ตาม policy

## Membership

Membership และ AI Token คิดตาม `store_id` เดียวกับร้านที่แสดงหน้าบ้าน

AI token หมดอาจ lock AI generation ใน Backoffice แต่ต้องไม่ทำลาย Order/Payment/Webhook ที่มีอยู่

## Events

ใช้ Event เพื่อ Sync และ Automation:

```text
store.updated
product.updated
product.stock_changed
salepage.published
order.created
payment.paid
order.paid
```

## AI Rule

ทุก AI action ที่แก้ Store/Product/Content/SalePage/Order ต้องเขียนผ่าน Domain Service ไป Source of Truth เดียว และบันทึก Audit/Event ห้ามแก้ UI-only state เพื่อหลอกว่าระบบเปลี่ยนแล้ว
