# AnnyPay Unified Activity Logging

## เป้าหมาย

ระบบนี้ทำให้ผู้ดูแลตอบคำถามได้ทันทีว่า:

- ใคร Login เข้าระบบ
- Login เวลาใด จาก Browser/อุปกรณ์ใด
- ใครเปิดหน้าบ้านหรือหลังบ้าน
- ใครสร้าง/แก้ร้าน สินค้า ราคา Content และ SalePage
- ลูกค้าดูสินค้าและเริ่ม Checkout เมื่อใด
- Order ใดถูกสร้างจากช่องทางไหน
- API ใดสำเร็จ/ล้มเหลว ใช้เวลากี่มิลลิวินาที
- AI ทำ Action อะไร
- Payment/Webhook เปลี่ยนสถานะเมื่อใด
- ใครเพิ่มบัญชีถอนเงินหรือขอถอนเงิน
- Error เกิดที่ส่วนใดและมี Request ID อะไร

## Storage

### `activity_logs`

Unified append-only log stream ของ Frontend, Backoffice, API, Database, AI, Payment, Billing, Webhook และ Payout

### `user_sessions`

Session registry สำหรับ Login, Last Seen, Logout และ Active status

### Structured JSON

Node backend ส่ง JSON line ไป stdout เสมอ และเขียน JSONL เพิ่มได้เมื่อกำหนด:

```text
ANNYPAY_LOG_FILE=/durable/path/annypay-audit.jsonl
```

บน Serverless ที่ Disk ไม่ถาวร ให้ใช้ stdout/log drain เป็นหลัก

## Request correlation

ทุก HTTP response มี Header:

```text
x-request-id: <uuid>
```

Browser ส่ง:

```text
x-annypay-session: <session-key>
x-annypay-page: <sanitized route>
x-annypay-area: FRONTEND|BACKOFFICE|AUTH
```

จึงเชื่อมเหตุการณ์ Page → Form → API → Database Change → Webhook ได้

## Data protection

ระบบ Redact/ไม่เก็บ:

```text
password
access_token
refresh_token
authorization
cookie
service role
api key
private key
webhook secret
เลขบัญชีเต็ม
เลขบัตร
CVV
raw sensitive payload
ค่าจาก input/form
```

IP ไม่เก็บแบบดิบ ใช้ HMAC hash เมื่อมี `LOG_IP_HASH_KEY`

## Login events

```text
AUTH.MAGIC_LINK_REQUESTED
AUTH.LOGIN_SUCCESS
AUTH.SESSION_RESUMED
AUTH.TOKEN_REFRESHED
AUTH.LOGOUT_REQUESTED
AUTH.LOGOUT
AUTH.LOGIN_FAILED
```

Login success ต้อง Validate Access Token ฝั่ง Backend ก่อนบันทึก user id/email

## Database audit

`database/audit-logs.sql` ผูก AFTER trigger กับตารางสำคัญ และสร้าง Event:

```text
DATA.STORES.INSERT
DATA.PRODUCTS.UPDATE
DATA.ORDERS.INSERT
DATA.PAYMENT_TRANSACTIONS.UPDATE
DATA.WITHDRAWAL_REQUESTS.INSERT
DATA.STORE_BALANCE_LEDGER.INSERT
```

Before/After ถูกลดข้อมูลและ Redact ก่อนเก็บ

## Backoffice UI

เปิด:

```text
/activity-logs.html
```

รองรับ:

- Filter Store
- Filter Source
- Filter Severity
- ค้น Event
- ช่วงเวลา
- Activity Log
- Login Sessions
- Active Sessions
- JSON Detail
- CSV Export ของรายการที่ผู้ใช้มีสิทธิ์อ่าน

## Install

รัน `database/audit-logs.sql` เป็น Migration ลำดับสุดท้ายหลังตารางทั้งหมด แล้วตั้งค่า Server ตาม `.env.example`
