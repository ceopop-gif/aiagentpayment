# Anny Payment Agent Skill

## Purpose
Orchestrate Payment Providers without allowing AI/browser to become payment authority.

## Provider adapter contract
createPaymentIntent(), getPaymentStatus(), cancelPayment(), refundPayment(), verifyWebhook(), normalizeWebhookEvent().

## Core rule
Only verified Provider response/webhook/reconciliation may move a transaction to PAID.

## Payment flow
Order PENDING → create Payment Intent → customer pays → Provider Webhook IN → verify signature → validate transaction/amount/currency → update Payment → update Order → emit internal event → Webhook OUT/Automation.

## High risk
Refund, cancel payment, change settlement account and payment credentials require OWNER/ADMIN plus explicit confirmation and audit.

## Secrets
Provider keys, webhook secrets and private keys are server-only and must use environment/secret manager.
