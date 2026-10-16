# Issue #31 — [BE] Integrate QR Payment Provider (payOS)

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/31
Branch: feature/31-payos-qr-provider (from origin/dev 818ba49, includes #29 via PR#30)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking the
GitHub checkboxes of this issue is allowed after verification (AGENTS.md section 14).
Note: the issue text refers to #14 (payment service) and #16 (webhook); in this repository those are #29 and a later issue.

## Scope
payOS adapter behind PaymentGateway: PayOsPaymentGateway (create link, best-effort cancel), PayOsProperties
(app.payment.payos.*, secrets masked in toString, validated only when PAYMENT_PROVIDER=PAYOS), PayOsSignature (HMAC-SHA256),
PayOsClient (Spring RestClient, no new dependency), integer VND amount check (supportsAmount, 409 before any attempt),
payOS orderCode as payment_reference (15 digits), description rules, after-commit cancel of expired attempts, and the
webhook signature verifier/parser components (no endpoint). MOCK stays the default. docs/payment-provider.md.

## Non-goals
Webhook endpoint, payment SUCCESS, order PAID, late/duplicate payment handling, polling/reconciliation, refunds, payouts,
e-invoice fields, storing checkoutUrl/paymentLinkId, confirm-webhook endpoint, other providers, kiosk UI, new dependencies,
schema change, new endpoint.

## Database / API impact
No schema change (V1-V12 untouched) and no new endpoint. Swagger/api-contract text only: qrCode is a VietQR payload for PAYOS,
409 documented for an unsupported amount.

## Verification facts
payOS docs (https://payos.vn/docs/api/, read 2026-10-15) confirm: create signature
`amount=..&cancelUrl=..&description=..&orderCode=..&returnUrl=..` HMAC_SHA256 with the checksum key, expiredAt Unix Int32,
cancel `POST /v2/payment-requests/{id}/cancel {cancellationReason}`, webhook body `{code,desc,success,data{...},signature}`.
The docs page does not state the webhook canonicalization; it follows the issue text and must be confirmed against a real webhook.

## Status and verification (2026-10-15)
Implemented and locally verified; nothing committed or pushed (see HANDOFF.md).
- `mvn --batch-mode --no-transfer-progress clean verify` (JDK 21.0.10, Maven 3.9.12, PostgreSQL 18.6 Testcontainers):
  566 tests, 0 failures/errors/skips, BUILD SUCCESS on the final code. Log: backend/target/issue31-verify.log (ignored).
- New classes: PayOsSignatureTest(6), PayOsWebhookTest(9), PayOsGatewayTest(11, loopback StubPayOsServer), PayOsIntegrationTest(11, PAYMENT_PROVIDER=PAYOS,
  real PostgreSQL), PayOsConfigurationTest(6); added to the #29 suites: cancel wiring (5), unsupported amount, reference collision.
  No automated test contacts the real payOS; no new dependency (pom unchanged); no migration.
- NOT verified (left unchecked): section 21, the four manual items that need a real payOS merchant account, a public webhook URL and a
  banking-app transfer. Webhook canonicalization follows the issue text and the docs sample; it is unconfirmed against a real captured webhook.
- Run Maven with JDK 21 and `clean` (an IDE auto-compiling into target/classes can break runs).

# Testing

No automated test may call the real payOS API.

## 14. Signature Tests

- [x] Create-signature string uses alphabetical key order and exact raw values
- [x] HMAC-SHA256 produces lowercase hex (checked against an RFC 4231 test vector for the HMAC helper)
- [x] Webhook verification succeeds for a correctly signed payload
- [x] Webhook verification fails for altered amount / orderCode / reference
- [x] Webhook verification fails for wrong checksum key
- [x] Null and empty values are canonicalized as documented
- [x] Malformed JSON / missing `data` / missing `signature` → verification fails without exception leak
- [x] Constant-time comparison is used

## 15. Parser Tests

- [x] `orderCode` → `paymentReference` decimal text
- [x] `reference` → `transactionId`
- [x] Integer `amount` → `BigDecimal` scale 2
- [x] `transactionDateTime` parsed as Asia/Ho_Chi_Minh → correct UTC `Instant`
- [x] `success` is true only when both top-level and data `code` are `"00"`

## 16. Gateway Tests (stubbed HTTP, e.g. `MockRestServiceServer`)

- [x] Create sends correct path, headers, body and signature
- [x] `expiredAt` equals attempt deadline in epoch seconds
- [x] Description respects max length and charset
- [x] `code = "00"` with `qrCode` → result returned
- [x] `code != "00"` → `PaymentProviderException`
- [x] HTTP 4xx/5xx → `PaymentProviderException`
- [x] Timeout → `PaymentProviderException`
- [x] Exception messages contain no secrets or response body
- [x] Cancel sends correct path and reason
- [x] Cancel failure/timeout is swallowed with WARN log

## 17. Amount / Reference Tests

- [x] `35000.00` supported; `35000.50` rejected → `409`, no attempt created
- [x] Zero / negative rejected
- [x] Generated reference is 15 digits, positive, ≤ 2^53−1
- [x] Reference collision triggers regeneration (unique index)

## 18. Integration Tests (MOCK HTTP server, real PostgreSQL)

- [x] With `PAYMENT_PROVIDER=PAYOS` and stubbed payOS, kiosk payment flow (#14) stores `PAYOS` attempt with QR
- [x] Provider failure → attempt `FAILED`, `502`, order unchanged
- [x] Kiosk cancel → attempt `EXPIRED`, then payOS cancel called after commit
- [x] Cancel is not called when the transaction rolls back
- [x] Expiry sweep triggers payOS cancel after commit

## 19. Configuration Tests

- [x] `PAYOS` with missing client id / api key / checksum key / URLs → startup fails, no secret in message
- [x] `MOCK` starts without payOS properties
- [x] Properties `toString()` does not reveal secrets

## 20. Log Safety Tests

- [x] API key, checksum key and signatures never appear in captured logs

## 21. Manual Verification (real payOS, not CI)

- [ ] Register payOS payment channel and webhook URL (via tunnel)
- [ ] Create a real attempt with a small amount (e.g. 2,000 VND) and scan QR with a banking app
- [ ] Received webhook payload passes `PayOsWebhookVerifier` (captured offline; endpoint arrives in #16)
- [ ] Cancelled link can no longer be paid on payOS checkout

Leave manual items unchecked if real payOS access is not available, and state the reason at handoff.

## 22. Regression

- [x] All existing tests pass (`mvn clean verify`)
- [x] MOCK flow from #14 unchanged
- [x] Swagger / api-contract consistency tests pass
- [x] Application starts with `MOCK` and with `PAYOS` (stubbed)

---

---

# Acceptance Criteria

The issue is complete when:

- [x] `PayOsPaymentGateway` implements `PaymentGateway`
- [x] payOS selected with `PAYMENT_PROVIDER=PAYOS`; `MOCK` remains default
- [x] Missing payOS configuration fails startup safely
- [x] Payment reference is a unique payOS-compatible integer
- [x] Non-integer VND amounts rejected with `409` before any attempt
- [x] Description respects payOS limits and contains no customer data
- [x] Create request signed with HMAC-SHA256 checksum key
- [x] payOS QR returned to kiosk through existing #14 flow
- [x] Provider errors/timeouts map to attempt `FAILED` / `502`
- [x] payOS link cancelled best-effort after commit when attempt expires
- [x] Webhook signature verifier and parser implemented and unit-tested
- [x] No business service depends on payOS classes
- [x] No real payOS call in automated tests
- [x] No secrets in logs, errors, docs or Git
- [x] No new dependency added
- [x] No schema change
- [x] Documentation (`docs/payment-provider.md`, `.ai/`, Swagger, api-contract) updated
- [x] Tests pass (`mvn clean verify`)
- [x] Application starts successfully

---
