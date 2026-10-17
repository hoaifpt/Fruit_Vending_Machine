# Chat handoff - Issue #33, 2026-10-16

Repository C:/Users/north/Documents/School/9/FruitMachine/backend, Spring module backend/.
Issue https://github.com/hoaifpt/Fruit_Vending_Machine/issues/33, [BE] Implement Payment Webhook Handling.
Branch feature/33-payment-webhook-handling from origin/dev b8345b5 (includes #31 via PR#32).
Git delivery: see the final report; do not assume commit/push/PR/merge happened.

Delivered: public POST /api/v1/webhooks/payments/{provider} (raw 64 KB JSON body, 401/404/413/415/500 policy), PaymentGateway.verifyWebhook (MOCK HMAC scheme, PAYOS via verifier/parser),
payment_webhook_logs written in a separate transaction for every attempt, PaymentConfirmationService (the only producer of payment SUCCESS and order PAID; Order then Payment locks, idempotent,
anomalies PAYMENT_LATE/DUPLICATE/AMOUNT_MISMATCH/TRANSACTION_CONFLICT in audit_logs), FAILED handling, links of other attempts cancelled after commit, ADMIN webhook-log APIs,
requiresAttention filter on payments, kiosk polling shows PAID. No schema change, no dispense/SOLD/refund. PAID orders keep bowls RESERVED (no PAID timeout yet).

Verification: clean verify 620 tests, 0 failures (JDK 21.0.10, PostgreSQL 18 Testcontainers). Checklist: all items checked except section 26 (3 manual payOS items).
Open: real payOS webhook registration and a captured real webhook to confirm signature canonicalization (needs merchant account + public HTTPS URL).
Environment: JAVA_HOME=C:/Program Files/Java/jdk-21.0.10, Docker Desktop running, always `mvn clean ...`.
Important: tests no longer read the developer .env (APP_DOTENV_IMPORT in Surefire); a real payOS payment link was created twice (unpaid, expired by itself) before this was fixed.
