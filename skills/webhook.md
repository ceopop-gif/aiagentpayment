# Anny Webhook & Integration Skill

## Webhook IN
Receive external/provider events → capture raw body → adapter → signature verification → idempotency → persist event → normalize → trusted state update → internal event.

Never process payment state if signature verification fails.
Unknown/mismatched transactions go to QUARANTINED state for reconciliation.

## Webhook OUT
Merchant registers HTTPS endpoint and subscribed events through trusted Backend API.
Server generates signing secret and stores only secret reference in database.

Delivery must include:
- event id
- event type
- timestamp
- HMAC SHA-256 signature

Delivery requirements:
- block localhost/private network destinations
- HTTPS in production
- timeout
- retries with backoff
- delivery logs
- dead-letter state
- manual redelivery by OWNER/ADMIN

Do not expose the signing secret after initial creation except through an approved rotate-secret flow.
