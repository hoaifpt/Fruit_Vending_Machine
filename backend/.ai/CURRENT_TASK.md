# Issue #33 — [BE] Implement Payment Webhook Handling

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/33
Branch: feature/33-payment-webhook-handling (from origin/dev b8345b5, includes #31 via PR#32)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking the
GitHub checkboxes of this issue is allowed after verification (AGENTS.md section 14).
Note: the issue text refers to #13/#14/#15; in this repository those are #27/#29/#31.

## Scope
Public `POST /api/v1/webhooks/payments/{provider}` (signature-based trust only): raw body read exactly (64 KB / JSON limits), every
attempt persisted in its own transaction (payment_webhook_logs), provider-neutral verification through a new
`PaymentGateway.verifyWebhook` (MOCK with HMAC secret, PAYOS via the #31 verifier/parser), idempotent processing
(lock Order -> Payment): the ONLY path producing payment SUCCESS and order PAID, anomalies (late, duplicate, amount mismatch,
transaction conflict) recorded in audit_logs and never auto-resolved, FAILED handling, ADMIN webhook-log read APIs,
`requiresAttention` payment filter, kiosk polling shows PAID.

## Non-goals
Dispense commands, inventory SOLD, DISPENSING/COMPLETED, refunds, reconciliation polling, replay endpoint, PAID timeout, alerts,
processing-status columns, rate limiting/IP allowlist, push to kiosk, frontend.

## Database / API impact
No schema change expected (V1-V12 untouched). New endpoints: the webhook, payment-webhook-logs list/detail, and the
`requiresAttention` filter on GET /api/v1/payments.

## Status and verification (2026-10-16)
Implemented and locally verified; see HANDOFF.md for Git delivery status.
- `mvn --batch-mode --no-transfer-progress clean verify` (JDK 21.0.10, Maven 3.9.12, PostgreSQL 18.6 Testcontainers): 620 tests, 0 failures/errors/skips,
  BUILD SUCCESS on the final code. Zero mentions of api-merchant.payos.vn in the run. Log: backend/target/issue33-verify.log (ignored).
- New classes: PaymentWebhookEndpointIntegrationTest(12), PaymentWebhookProcessingIntegrationTest(18), PaymentWebhookRaceIntegrationTest(4, real parallel transactions),
  PaymentWebhookRollbackIntegrationTest(1), PaymentWebhookLogManagementIntegrationTest(4), MockWebhookSchemeTest(6), MockWebhookIntegrationTest(1),
  PayOsWebhookIntegrationTest(5, payOS-signed fixtures), PaymentWebhookDocumentationTest(1), DotenvIsolationTest(2). No migration, no dependency (pom.xml only gained a Surefire system property).
- NOT verified (left unchecked): section 26, the three manual items that need a real payOS merchant account, a public HTTPS webhook URL and a real payment.
  The payOS webhook signature canonicalization is implemented from the issue text and the docs sample and is still unconfirmed against a captured real webhook.
- Test isolation fix found during this issue: the developer .env (real provider and credentials) was being imported into test contexts, so one default-provider test
  created payment attempts through the real payOS (twice, unpaid, auto-expiring links of 70,000 VND). application.yaml now reads `${APP_DOTENV_IMPORT:...}`, Surefire sets it to a missing file,
  AbstractCoreIntegrationTest defaults app.payment.provider=MOCK and DotenvIsolationTest guards it. CODING_RULES section 36 records the rule.
- Design notes: requiresAttention follows the issue text literally (a duplicate lists both SUCCESS payments; the one with the later paid_at is the refund candidate); amount mismatch also applies to FAILED events that carry an amount;
  PaymentGateway.verifyWebhook has a safe default that verifies nothing; a 401 is returned both for failed verification and for a signed but unparsable body.
- Run Maven with JDK 21 and `clean` (an IDE auto-compiling into target/classes can break runs).

# Testing

## 17. Endpoint / Verification Tests

- [x] Valid MOCK signature → processed, `200`
- [x] Invalid / missing signature → `401`, no state change
- [x] Malformed JSON → `401`, logged with `raw_payload = NULL`
- [x] Unknown / inactive provider path → `404`
- [x] Body > 64 KB → `413`
- [x] Non-JSON content type → `415`
- [x] Body is verified from exact raw bytes (whitespace-sensitive test)
- [x] payOS-signed payload (fixture signed in test with test key) → processed via `PayOsWebhookVerifier`

## 18. Logging Tests

- [x] Every attempt (valid, invalid, malformed, unknown reference) creates exactly one log row
- [x] Log row survives when business processing rolls back
- [x] `is_verified` reflects verification result
- [x] `order_code` holds the provider reference hint (≤ 64 chars)
- [x] Signature and raw body never appear in application logs (log capture)

## 19. Success Processing Tests

- [x] PENDING payment + PENDING_PAYMENT order → payment `SUCCESS` (txn id, paid_at), order `PAID` (paid_at)
- [x] Other PENDING attempts of the order → `EXPIRED`
- [x] Inventory items and allocations remain `RESERVED`
- [x] No dispense command, no `SOLD`, no `DISPENSED`
- [x] Order past `expires_at` but still PENDING_PAYMENT → `PAID`
- [x] Kiosk polling shows `PAID` and payment `SUCCESS`
- [x] Expiry sweep after PAID does not touch the order

## 20. Idempotency Tests

- [x] Same webhook delivered twice → second is no-op, `200`, one SUCCESS only
- [x] Same webhook delivered concurrently (parallel requests) → exactly one state change
- [x] Transaction id reused for a different payment → `TRANSACTION_CONFLICT`, no change
- [x] SUCCESS payment receiving a different transaction id → `TRANSACTION_CONFLICT`

## 21. Anomaly Tests

- [x] Amount mismatch → payment unchanged, `PAYMENT_AMOUNT_MISMATCH` audit row, `200`
- [x] Payment for CANCELLED order → payment `SUCCESS`, order stays `CANCELLED`, no re-reservation, `PAYMENT_LATE` audit row
- [x] Second successful attempt on PAID order → payment `SUCCESS`, order unchanged, `PAYMENT_DUPLICATE` audit row
- [x] EXPIRED / FAILED payment receiving SUCCESS → `SUCCESS`
- [x] Unknown reference → `200`, log only, no audit row
- [x] `requiresAttention=true` returns late and duplicate payments only

## 22. FAILED Event Tests

- [x] PENDING → FAILED, order unchanged
- [x] FAILED event on SUCCESS payment → ignored

## 23. Race Tests (real PostgreSQL)

- [x] Webhook vs expiry sweep on the same order → exactly one of {PAID, CANCELLED+LATE_PAYMENT}
- [x] Webhook vs kiosk cancel → consistent result, inventory never both released and PAID
- [x] Webhook vs #14 attempt creation step 3 → no lost update

## 24. Management API Tests

- [x] ADMIN can list webhook logs with pagination and filters
- [x] ADMIN can view detail with raw payload/body
- [x] Signature never returned
- [x] STAFF → `403`; unauthenticated → `401`; kiosk key → `401`

## 25. Documentation / Regression Tests

- [x] Swagger UI shows webhook and webhook-log operations with correct security
- [x] `api-contract/api.yaml` matches exposed OpenAPI
- [x] All existing tests pass (`mvn clean verify`)
- [x] #13/#14/#15 behavior unchanged except documented extensions
- [x] Application starts with MOCK and with PAYOS (stubbed)

## 26. Manual Verification (real payOS, not CI)

- [ ] Register webhook URL via tunnel; payOS confirm-webhook succeeds (`200`)
- [ ] Real small payment → order `PAID`, kiosk polling shows `PAID`
- [ ] Re-delivery from payOS (if triggerable) is a no-op

Leave manual items unchecked if real payOS access is not available, and state the reason at handoff.

---

---

# Acceptance Criteria

The issue is complete when:

- [x] `POST /api/v1/webhooks/payments/{provider}` implemented for the active provider
- [x] Raw body read exactly; size/content-type limits enforced
- [x] Every webhook attempt persisted in its own transaction
- [x] Signature verified via `PaymentGateway` (MOCK and PAYOS)
- [x] Unverified requests never change payment/order state
- [x] Payment resolved by `(provider, payment_reference)`
- [x] Amount validated with `BigDecimal.compareTo`
- [x] Payment `SUCCESS` and order `PAID` produced only by verified webhook
- [x] Other pending attempts expired on PAID
- [x] Duplicate deliveries are idempotent (sequential and concurrent)
- [x] Late, duplicate, mismatched and conflicting payments recorded as anomalies
- [x] No re-reservation for late payments; no automatic refund
- [x] Response policy (§5) implemented
- [x] Lock order `Order → Payment → InventoryItem` respected
- [x] Webhook log list/detail APIs work (ADMIN only, no signature exposure)
- [x] `requiresAttention` filter works
- [x] No dispense / SOLD / DISPENSED side effects
- [x] No secrets, signatures or raw bodies in application logs
- [x] Existing RBAC and common error handling reused
- [x] Swagger/OpenAPI and `api-contract/api.yaml` updated and consistent
- [x] `.ai/` docs and `docs/payment-webhook.md` updated
- [x] Tests pass (`mvn clean verify`)
- [x] Flyway validation passes
- [x] Hibernate `ddl-auto=validate` passes
- [x] Existing applied migrations remain unchanged

---
