# AnnyPay Billing & AI Token Skill

## Purpose
ระบบ AnnyPay คิดค่าสมาชิกรายเดือน **ต่อร้าน (`store_id`)** และแต่ละแพ็กเกจกำหนดโควตา AI Token ต่อรอบบิล ร้านที่ใช้ Token เกินโควตาต้องซื้อ Token Pack เพิ่มก่อนใช้ AI ต่อ

## Core Rules

1. ร้านต้องมี `store_subscriptions.status` เป็น `ACTIVE` หรือ `TRIAL` จึงใช้ฟังก์ชัน AI ที่มีค่าใช้จ่ายได้
2. Token รายเดือน (`monthly_remaining`) มาจากแพ็กเกจและ Reset เมื่อเริ่มรอบบิลใหม่
3. Token รายเดือนที่เหลือไม่ทบไปเดือนถัดไป เว้นแต่แพ็กเกจในอนาคตกำหนดเป็นอย่างอื่น
4. Token ซื้อเพิ่ม (`topup_remaining`) แยกจาก Token รายเดือน และไม่ถูกล้างตอน Reset รอบบิล
5. การหัก Token ต้องทำฝั่ง Trusted Backend แบบ Atomic เท่านั้น ห้ามให้ Browser ลด/เพิ่ม Balance เอง
6. ใช้ Monthly Token ก่อน แล้วจึงใช้ Top-up Token
7. ถ้า Balance ไม่พอ ห้ามเรียก AI Provider ต่อ และตอบสถานะ `INSUFFICIENT_AI_TOKENS` พร้อมแนะนำซื้อ Token Pack
8. ถ้า Subscription ไม่ Active ให้ตอบ `SUBSCRIPTION_REQUIRED` หรือ `SUBSCRIPTION_EXPIRED` และไม่เรียก AI Provider
9. Token ที่ซื้อเพิ่มจะ Grant หลังระบบ Payment ยืนยัน `PAID` จาก Provider/Webhook เท่านั้น
10. Monthly Token จะ Grant หลัง Invoice/Subscription payment ได้รับการยืนยันจาก Trusted Backend
11. ทุกการใช้ AI ต้องเก็บ Usage Log และ Token Ledger เพื่อ Audit
12. ห้ามแก้ Token Balance โดยลบ/แก้ Ledger เดิม ให้ทำ `ADJUSTMENT` เพิ่มใหม่

## Billing Flow

```text
Create Store
→ Choose Monthly Plan
→ Subscription Invoice / Checkout
→ Payment Provider
→ Verified Billing Webhook
→ Subscription ACTIVE
→ Grant Monthly AI Tokens
→ AI Features Enabled
```

## AI Usage Flow

```text
AI Prompt
→ Resolve Billing Store
→ Check Subscription
→ Check Token Balance
→ Load SKILL.md + Billing Skill + Domain Skill
→ Call AI Provider
→ Read actual provider token usage
→ Atomic consume_store_ai_tokens()
→ AI Action Log + AI Usage Record + Token Ledger
→ Return Result + Remaining Tokens
```

ถ้า Provider ไม่ส่ง Usage ให้ Gateway ควรประมาณ Usage แบบ conservative และบันทึก `usage_estimated=true` ใน metadata

## Token Exhaustion

```text
monthly_remaining = 0
AND topup_remaining = 0
→ AI LOCKED
→ Show Buy Token CTA
→ Select Token Pack
→ Payment Pending
→ Verified Payment
→ grant_token_topup()
→ AI UNLOCKED
```

## Subscription Status

```text
PENDING
TRIAL
ACTIVE
PAST_DUE
SUSPENDED
CANCELLED
EXPIRED
```

- `ACTIVE` / `TRIAL`: AI ใช้งานได้เมื่อ Token > 0
- `PAST_DUE`: ปิด AI Generation ใหม่ แต่ยังให้ Merchant เข้าดูข้อมูลและ Order ได้
- `SUSPENDED`, `CANCELLED`, `EXPIRED`: ปิด AI จนกว่าจะต่ออายุ/Activate ใหม่
- ระบบไม่ควรหยุดรับ Webhook Payment หรือทำลาย Order ที่มีอยู่เพียงเพราะ Subscription หมดอายุ

## Backoffice Billing UI

แต่ละร้านต้องเห็น:

- Current Plan
- Monthly Fee
- Subscription Status
- Next Billing Date
- Monthly AI Tokens
- Used Tokens
- Monthly Remaining
- Top-up Remaining
- Total Remaining
- Usage History
- Token Ledger
- Token Packs
- Buy More Tokens
- Billing / Invoice History

## Pricing
ราคาแพ็กเกจ, Monthly Token quota และ Token Pack ต้องเป็นข้อมูล Configurable ใน Database ห้าม Hard-code ใน AI Skill

## AI Cost Metering
ให้ใช้ Token Usage จริงจาก AI Provider ถ้ามี:

```text
input_tokens
output_tokens
total_tokens = input_tokens + output_tokens
```

สำหรับ Model/Feature ที่ไม่ได้คิดแบบ Text Token ให้ระบบมี Conversion Rule ภายหลังโดยไม่เปลี่ยน Ledger Architecture

## Payment Authority
การชำระ Membership หรือซื้อ Token เพิ่มถือเป็น Payment เช่นเดียวกับ Order Payment:

**Browser/AI ห้ามตั้ง Subscription/Token Purchase เป็น PAID เอง**

ต้องยืนยันจาก Provider response หรือ Verified Webhook ก่อน Grant Token เสมอ
