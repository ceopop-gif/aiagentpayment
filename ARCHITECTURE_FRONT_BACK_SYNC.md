# AnnyPay Frontend ↔ Backoffice Unified Architecture

AnnyPay ต้องใช้ข้อมูลชุดเดียวกันระหว่างหน้าบ้านและหลังบ้าน ห้ามสร้าง Product, Price, Stock, SalePage, Order หรือ Payment state ซ้ำคนละชุด

## Shared Identity

ทุก Flow ต้องอ้างอิง ID เดียวกัน:

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

```text
Supabase/PostgreSQL = Source of Truth
```

Backoffice เขียนข้อมูลผ่าน authenticated RLS / trusted backend
Storefront อ่านเฉพาะ public publishable data ผ่าน RPC/API
Payment authoritative state เขียนผ่าน trusted provider/webhook flow เท่านั้น

## Backoffice → Frontend

```text
Backoffice
→ Create/Update Store
→ Create/Update Product
→ Create/Approve Content
→ Create/Publish SalePage
→ PostgreSQL
→ Public Storefront RPC/API
→ sale.html / storefront
```

เมื่อ Merchant เปลี่ยนราคา Stock รายละเอียด หรือ SalePage แล้ว Publish ข้อมูลหน้าบ้านต้องอ่านค่าปัจจุบันจาก Database ไม่ใช้ snapshot/demo data ใน HTML

## Frontend → Backoffice

```text
Customer
→ SalePage / Payment Link
→ Checkout
→ Server authoritative validation
→ Customer + Order + Order Items
→ Database
→ Backoffice Dashboard / Orders
```

Order ที่สร้างจากหน้าบ้านต้องปรากฏในหลังบ้านด้วย order_id เดียวกัน

## Payment Sync

```text
Frontend Checkout
→ Order WAITING_PAYMENT
→ Payment Intent
→ Provider
→ Verified Webhook IN
→ payment_transactions
→ orders.payment_status = PAID
→ orders.order_status = PAID
→ Internal Event
→ Backoffice realtime/refresh
→ Webhook OUT / Automation
```

Browser และ AI ห้ามตั้ง PAID เอง

## Inventory Sync

Product stock ใน `products` เป็น authoritative stock

- หน้า Storefront อ่าน stock ปัจจุบันจาก Database
- Checkout ต้อง validate stock server-side
- Order PENDING ไม่ควรตัด stock ถาวรโดยตรง
- Paid/reservation flow เป็นผู้ mutate stock ตาม policy

## Content Sync

`content_assets` เป็น asset กลาง

Backoffice AI Content Studio → content_assets → SalePage content mapping → Public SalePage

ห้ามให้หน้าบ้านสร้าง claim/review/content ที่ไม่ผ่าน Merchant/AI policy

## Membership / AI Token Sync

สมาชิกคิดต่อ `store_id`

Backoffice AI request → billing entitlement → token wallet → AI Provider → usage ledger

หน้าบ้านยังขายสินค้า/รับ Order ได้ตาม storefront policy แม้ AI token หมด แต่ AI generation ในหลังบ้านต้องถูก lock

## Event Sync

Domain services publish events เช่น:

```text
store.updated
product.updated
product.stock_changed
salepage.published
order.created
payment.paid
order.paid
```

Event ถูกใช้สำหรับ:
- Backoffice refresh/realtime
- Automations
- Webhook OUT
- Notifications
- Analytics

## Rule

> One Database. One Order. One Payment State. One Store Identity.

Frontend และ Backoffice เป็นเพียงคนละ interface ของ AnnyPay Core เดียวกัน
