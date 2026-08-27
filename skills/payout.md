# AnnyPay Payout, Balance & Withdrawal Skill

## Purpose
แต่ละร้าน (`store_id`) มี Balance ของตัวเองใน Database กลาง และลงทะเบียนบัญชีรับเงินได้สูงสุด 5 บัญชี ถอนเงินได้เฉพาะบัญชีของร้านนั้นที่ `ACTIVE` + verified แล้วเท่านั้น

## Money Source of Truth
Current balance ต้องอ่านจาก `store_balances` ไม่คำนวณใหม่จาก Browser และมี `store_balance_ledger` เป็นประวัติ immutable สำหรับ Audit

Balance buckets:
```text
pending_balance   เงินจาก Payment PAID ที่ยังอยู่ในช่วง Hold
available_balance เงินที่ถอนออกได้
reserved_balance  เงินที่ถูกจองไว้ให้ Withdrawal แล้ว
total_paid_out    ยอดถอนสำเร็จสะสม
```

## Payment → Balance Flow
```text
Payment Provider
→ Verified payment.paid Webhook
→ payment_transactions = PAID
→ credit_paid_payment_to_store_balance()
→ Pending Balance
→ hold_minutes ครบ
→ release_matured_store_funds()
→ Available Balance
```

ทุก Credit/Release ต้องมี idempotency key เพื่อไม่ให้ webhook retry ทำยอดซ้ำ

## Core Rules
1. Database เดียว แต่ Balance/บัญชีถอน/Withdrawal แยกด้วย `merchant_id + store_id`.
2. ร้านหนึ่งมีบัญชีรับเงินได้สูงสุด 5 บัญชีที่ยังไม่ `REMOVED`.
3. Full bank account number ห้ามอยู่ใน Browser log, AI prompt หรือ plain-text DB; เก็บผ่าน Secret Store เท่านั้น.
4. บัญชีใหม่ = `PENDING_VERIFICATION`; ถอนเงินไม่ได้จน `ACTIVE` + `verified_at`.
5. Withdrawal ต้องอ้าง `payout_account_id`; ห้ามกรอกบัญชีปลายทางใหม่ในขั้นถอน.
6. ตอนสร้าง Withdrawal ต้อง reserve เงินแบบ atomic: `Available → Reserved` ก่อนส่ง Provider.
7. ถ้า Available ไม่พอ ให้ตอบ `INSUFFICIENT_AVAILABLE_BALANCE` และห้ามสร้าง payout.
8. Withdrawal amount/fee/net/destination snapshot แก้ย้อนหลังไม่ได้.
9. ถ้า Provider ยืนยัน `PAID`: `Reserved → total_paid_out`.
10. ถ้า Provider `FAILED/REJECTED/CANCELLED`: `Reserved → Available` คืนอัตโนมัติแบบ idempotent.
11. AI/Browser ห้ามตั้ง Withdrawal เป็น `PAID` เอง.
12. Payout Provider ต้องผ่าน Adapter Interface และ Webhook ต้อง Verify Signature.
13. Risk policy ต่อ Store ปรับได้: hold, min/max per request, daily limit, manual-review threshold.
14. Manual review/risk block ต้องหยุดก่อน Provider submission.
15. Ledger row ห้าม UPDATE/DELETE; correction ใช้ ADJUSTMENT row ใหม่.

## Account Status
```text
PENDING_VERIFICATION
VERIFIED
ACTIVE
DISABLED
REJECTED
REMOVED
```
Only `ACTIVE` + verified is eligible.

## Withdrawal Status
```text
REQUESTED
HELD
REVIEWING
APPROVED
PROCESSING
PAID
FAILED
REJECTED
CANCELLED
```

## Withdrawal Flow
```text
Available Balance
→ Select ACTIVE payout_account_id
→ Explicit confirmation
→ Create immutable withdrawal snapshot
→ Atomic Reserve (Available → Reserved)
→ Risk PASS = HELD
→ Submit to configured Payout Provider
→ PROCESSING
→ Signed Provider Webhook / authoritative response
→ PAID
→ Reserved decreases + total_paid_out increases
```

Failure flow:
```text
PROCESSING/HELD
→ Provider FAILED/REJECTED
→ release_store_withdrawal()
→ Reserved decreases
→ Available restored
```

## Payout Provider Adapter
```text
verifyAccount()
createPayout()
getPayoutStatus()
verifyWebhook()
normalizeWebhookEvent()
```
No provider is considered connected until its adapter and secrets are explicitly configured.

## AI Rules
Allowed assistance:
- แสดงยอดรอ Hold / ยอดถอนได้ / ยอดจองถอน
- แสดงบัญชีรับเงินที่ลงทะเบียน
- เช็กสถานะ Withdrawal
- เตรียม Withdrawal จากบัญชีที่ ACTIVE

High Risk:
- REQUEST_WITHDRAWAL
- SET_DEFAULT_PAYOUT_ACCOUNT
- REMOVE_PAYOUT_ACCOUNT
- CHANGE_PAYOUT_ACCOUNT

AI must never ask the user to paste a full bank account number into ordinary chat when `payouts.html` secure form is available.
