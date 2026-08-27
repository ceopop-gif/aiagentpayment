# AnnyPay Unified Activity, Login & Audit Logging Skill

## Purpose
ระบบต้องตอบได้ว่า **เกิดอะไรขึ้น, ใครทำ, เมื่อไร, ที่หน้าหรือโมดูลใด, กับร้าน/ข้อมูลใด, และสำเร็จหรือผิดพลาด** ครอบคลุมหน้าบ้าน หลังบ้าน Login, API, AI, Payment, Webhook, Billing, Payout และ Database.

## Core Rules
1. ใช้ `activity_logs` เป็น Unified Append-only Audit Stream.
2. ใช้ `user_sessions` สำหรับ Login time, Last seen, Logout time และ Session status.
3. ทุก Event ต้องมี `occurred_at`, `event_name`, `source_area`, `actor_type`, `success` และบริบทที่ทราบ.
4. ผู้ใช้ที่ Login ต้องระบุ `actor_user_id` และ `actor_email_snapshot`; ห้ามเชื่อ Actor ID จาก Browser โดยไม่ตรวจ Access Token.
5. ทุก Merchant/Store event ต้องผูก `merchant_id`/`store_id` เท่าที่ระบบทราบ.
6. API ทุกคำขอต้องมี `request_id`; response ส่ง `x-request-id` กลับเพื่อค้นเหตุการณ์.
7. Frontend/Backoffice ต้องมี `session_key` ต่อ browser tab/session เพื่อเชื่อม Page View, Click, Form, API และ Login.
8. Database changes สำคัญต้องถูกบันทึกด้วย Trigger แม้เกิดจาก Browser direct write, Backend, AI, Webhook หรือ System job.
9. Activity Log ห้ามแก้/ลบย้อนหลังจาก Merchant UI. การเก็บถาวร/retention ต้องเป็นกระบวนการ Platform Admin แยกต่างหาก.
10. Logging failure ต้องไม่ทำให้ Order/Payment/Payout business transaction ล้มเหลว แต่ต้องส่ง structured error ไป Host logs.
11. Server ต้องเขียน Structured JSON line ไป stdout และอาจเขียน JSONL file เมื่อกำหนด `ANNYPAY_LOG_FILE`.
12. ห้ามบันทึก Password, Access/Refresh Token, Authorization/Cookie, Service Role, API Key, Secret, Private Key, Webhook Secret, เลขบัญชีเต็ม, เลขบัตร, CVV หรือ raw sensitive payload.
13. IP ให้เก็บเป็น HMAC hash เท่านั้นเมื่อกำหนด `LOG_IP_HASH_KEY`; ไม่เก็บ IP ดิบใน Merchant audit view.
14. Customer PII ใน before/after snapshot ต้องลดข้อมูลและ Mask; Log ไม่ใช่ที่เก็บข้อมูลลูกค้าสำรอง.
15. Payment/Payout state authority ยังคงมาจาก Verified Provider เท่านั้น; Log เป็นหลักฐาน ไม่ใช่ตัวกำหนดสถานะ.

## Required Source Areas
```text
AUTH
FRONTEND
BACKOFFICE
API
DATABASE
AI
PAYMENT
PAYOUT
BILLING
WEBHOOK
SECURITY
SYSTEM
```

## Actor Types
```text
USER
CUSTOMER
ANONYMOUS
AI
SYSTEM
PROVIDER
```

## Authentication Events
```text
AUTH.MAGIC_LINK_REQUESTED
AUTH.LOGIN_SUCCESS
AUTH.LOGIN_FAILED
AUTH.SESSION_RESUMED
AUTH.TOKEN_REFRESHED
AUTH.LOGOUT_REQUESTED
AUTH.LOGOUT
AUTH.SESSION_REVOKED
```

Login success ต้องมาจาก Authenticated Backend validation เท่านั้น. Magic Link request ก่อน Login ให้เก็บ Email hash ไม่เก็บ Email plain text ใน anonymous event.

## Frontend Events
```text
CLIENT.PAGE_VIEW
CLIENT.STOREFRONT_VIEW
CLIENT.PRODUCT_VIEW
CLIENT.CHECKOUT_STARTED
CLIENT.ORDER_CREATED
CLIENT.FORM_SUBMIT
CLIENT.UI_CLICK
CLIENT.CLIENT_ERROR
CLIENT.API_CLIENT_ERROR
```

ห้ามเก็บค่าจาก Input/Form อัตโนมัติ. เก็บเฉพาะ form id, action, element id, route และ metadata ที่ผ่าน sanitizer.

## Backoffice / Business Events
Database audit triggers ต้องครอบคลุม Store, Product, Content, SalePage, Order, Payment, Webhook, Subscription, Token, Payout Account, Withdrawal, Store Balance และ Automation.

Event pattern:
```text
DATA.<TABLE>.<INSERT|UPDATE|DELETE>
```

## API Event
```text
API.REQUEST
```
Required context:
```yaml
request_id:
trace_id:
session_key:
actor_user_id:
merchant_id:
store_id:
route:
http_method:
http_status:
duration_ms:
success:
error_code:
```

## Session Registry
`user_sessions` ต้องเก็บ:
```yaml
session_key:
user_id:
email_snapshot:
merchant_id:
store_id:
login_at:
last_seen_at:
logout_at:
status:
login_source:
ip_hash:
user_agent:
```

## Audit UI
Merchant Backoffice ต้องมีหน้า Activity Logs ที่:
- Filter ตาม Store, Source, Severity, Event และช่วงเวลา
- แสดงผู้ใช้/Email, เวลา, Route, Resource, Result และ Request ID
- แสดง Login Sessions และ Active Sessions
- เปิด JSON Detail
- Export เฉพาะข้อมูลที่ผู้ใช้มีสิทธิ์อ่าน
- ไม่แสดง Secret หรือ PII ที่ถูก Redact

## AI Behavior
Anny AI เมื่อถูกถาม:
- ใคร Login ล่าสุด
- เมื่อวานเกิด Error อะไร
- ใครเปลี่ยนราคาสินค้า
- Payment นี้เปลี่ยนเป็น PAID เมื่อไร
- ใครขอถอนเงิน
- Webhook ใดล้มเหลว

ต้องอ่าน `activity_logs`/`user_sessions` ภายใต้ Merchant permission และตอบจาก Log จริง ห้ามเดา.

High-risk action ทุกประเภทต้องมีทั้ง Business Audit และ Unified Activity Log.
