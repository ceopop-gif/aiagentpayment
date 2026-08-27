# AnnyPay Payout & Withdrawal Skill

## Purpose
แต่ละร้าน (`store_id`) สามารถลงทะเบียนบัญชีรับเงินได้สูงสุด 5 บัญชี และถอนเงินออกได้เฉพาะบัญชีที่ลงทะเบียนกับร้านนั้นและมีสถานะ `ACTIVE` พร้อม `verified_at` แล้วเท่านั้น

## Core Rules
1. Database เดียว แต่บัญชีถอนเงินแยกตาม `store_id`.
2. ร้านหนึ่งมีบัญชีรับเงินได้ไม่เกิน 5 บัญชีที่ยังไม่ `REMOVED`.
3. Full account number ห้ามเก็บใน Browser, AI prompt, log หรือ plain-text client state.
4. Full account number ต้องเก็บผ่าน trusted Secret Store; DB ฝั่ง merchant เก็บเฉพาะ `account_number_ref`, `last4`, fingerprint และข้อมูลแสดงผล.
5. บัญชีใหม่เริ่ม `PENDING_VERIFICATION` และห้ามถอนจนกว่าจะ `ACTIVE` + verified.
6. Withdrawal Request ต้องอ้าง `payout_account_id`; ห้ามกรอกเลขบัญชีปลายทางอิสระตอนถอน.
7. Backend และ DB ต้องตรวจว่า payout account เป็นของ `merchant_id` + `store_id` เดียวกัน.
8. Withdrawal destination snapshot, amount และ currency ต้อง immutable หลังสร้างคำขอ.
9. AI/Browser ห้ามตั้ง Withdrawal เป็น `PAID` เอง; ต้องมาจาก trusted payout provider / bank transfer confirmation / reconciliation.
10. การเพิ่ม ลบ เปลี่ยน หรือเปิดใช้งานบัญชีถอนเงินเป็น High-Risk Action ต้องตรวจ Role และ Explicit Confirmation.
11. การถอนเงินต้องบันทึก Audit และ provider reference ทุกครั้ง.
12. ถ้าบัญชีถูก `DISABLED` หรือ `REMOVED` จะสร้าง Withdrawal ใหม่ไม่ได้ แต่ประวัติ Withdrawal เดิมต้องยังอ่านได้จาก snapshot.

## Account Status
```text
PENDING_VERIFICATION
VERIFIED
ACTIVE
DISABLED
REJECTED
REMOVED
```

Only `ACTIVE` + `verified_at != null` is withdrawable.

## Withdrawal Status
```text
REQUESTED
REVIEWING
APPROVED
PROCESSING
PAID
FAILED
REJECTED
CANCELLED
HELD
```

## Registration Flow
```text
Merchant / Owner
→ Add payout account
→ Encrypt full account number in Secret Store
→ Save masked account + fingerprint in payout_accounts
→ PENDING_VERIFICATION
→ Verify account ownership / bank validation
→ VERIFIED
→ Activate
→ ACTIVE
→ Eligible for Withdrawal
```

## Withdrawal Flow
```text
Store available balance
→ Select registered payout_account_id
→ Backend validates SAME store + ACTIVE + verified
→ Create withdrawal_requests snapshot
→ REQUESTED
→ Risk / balance / hold checks
→ APPROVED
→ Payout Provider / Bank Transfer
→ PROCESSING
→ Provider confirmation
→ PAID
```

## AI Intent Examples
- แสดงบัญชีถอนเงินของร้านนี้
- เพิ่มบัญชีรับเงินให้ร้านนี้
- ตั้งบัญชีนี้เป็นบัญชีหลัก
- ถอนเงิน 10,000 บาทเข้าบัญชีที่ลงทะเบียนไว้
- เช็กสถานะการถอนล่าสุด

AI must never ask the user to paste a full bank account number into an ordinary chat prompt if a secure account-entry form is available.
