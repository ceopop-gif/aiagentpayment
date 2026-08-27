# AnnyPay Payment Fact / QR Snapshot Skill

## Purpose
ทุก QR / Payment Intent ต้องสร้าง `payment_transactions` 1 แถวที่ตอบได้ทันทีว่า:

- Merchant ไหน
- Store ไหน
- Order ไหน
- ลูกค้าคนไหน
- ซื้อสินค้าอะไรบ้าง
- จำนวนเท่าไร
- Subtotal / Discount / Shipping / Total เท่าไร
- Currency อะไร
- เงื่อนไขการสั่งซื้อ ณ เวลานั้นคืออะไร
- สร้าง QR วันเวลาใด
- QR หมดอายุเมื่อใด
- Provider/Provider Transaction ID คืออะไร
- Payment status ปัจจุบันคืออะไร

## Core Rule
Normalized Commerce tables (`stores`, `products`, `orders`, `order_items`) เป็น master operational data แต่เมื่อสร้าง QR ให้ Snapshot commercial facts ลง `payment_transactions` ทันที เพื่อให้ Transaction เป็น self-describing record และไม่ต้อง JOIN master tables เพื่อค้นหาบริบทของการรับเงินย้อนหลัง

## Payment Reference
ทุก QR ต้องมี `payment_ref` ของ AnnyPay เช่น:

```text
AP20260827-1A2B3C4D5E6F
```

ควรส่ง reference นี้ไป Provider metadata / merchant reference field เมื่อ Provider รองรับ

## One-row Fact Fields

```text
payment_ref
merchant_id
store_id
store_name_snapshot
order_id
order_no_snapshot
customer_id
customer_name_snapshot
customer_phone_snapshot
sales_channel
sale_page_id
payment_link_id
provider
provider_transaction_id
item_count
quantity_total
product_summary
items_snapshot
subtotal_snapshot
discount_snapshot
shipping_snapshot
amount
currency
purchase_conditions_snapshot
shipping_address_snapshot
requested_at
qr_payload
qr_expires_at
status
paid_at
```

## Immutability
ข้อมูลทางการค้า ณ เวลาสร้าง QR ต้อง Immutable:

- ร้าน
- Order
- รายการสินค้า
- จำนวน
- ราคา
- ส่วนลด
- ค่าส่ง
- Total/Currency
- Purchase Conditions
- Requested time
- QR payload/expiry

แม้ Product master หรือ Store name จะเปลี่ยนภายหลัง Snapshot เดิมต้องไม่เปลี่ยน

ส่วนที่เปลี่ยนได้ตาม Payment lifecycle ได้แก่:

```text
status
fee
paid_at
raw_provider_data
```

## Webhook Rule
Webhook IN หลัง Verify Signature แล้ว ต้องหา `payment_transactions` จาก `provider_transaction_id` หรือ `payment_ref` เพียงแถวเดียว จากนั้นตรวจ `amount/currency` กับ Snapshot และอัปเดต Payment state ได้ทันที

ไม่ต้อง JOIN Store/Product/Order เพื่อรู้ว่ารายการคืออะไร

การอัปเดต Order ใช้ `order_id` ที่ Snapshot มีอยู่แล้ว เป็น direct update ไม่ใช่ lookup

## Reporting/Search
Dashboard, reconciliation, support และ export ควรค้นจาก Payment Fact โดยตรง เช่น:

- payment_ref
- provider_transaction_id
- order_no_snapshot
- store_id
- customer_phone_snapshot
- status
- requested_at range

การ Query master tables ใช้เมื่อ Merchant ต้องการข้อมูลปัจจุบันของ Store/Product เท่านั้น ไม่ใช่เพื่อสร้างประวัติ Transaction ย้อนหลัง
