# Issue #29 — [BE] Implement Payment Service

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/29
Branch: feature/29-payment-service (from origin/dev de4457a, includes #27 via PR#28)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge/GitHub issue edits.
Note: the issue text refers to #13/#15/#16; in this repository the order issue is #27 and the
real-provider/webhook issues are later, unassigned issues.

## Scope
Provider-independent payment layer: PaymentGateway abstraction with one configured gateway
(MOCK for dev/tests, forbidden in prod), kiosk create-or-reuse payment attempt (QR) with a
three-step flow that never holds a DB transaction during the provider call, PENDING -> FAILED/EXPIRED
only, pending payments EXPIRED on order cancel/expiry (lock order Order -> Payment -> InventoryItem),
currentPayment in kiosk order polling, ADMIN payments list/detail, payment summaries in order details,
V12 unique (provider, payment_reference), 502 mapping for provider failures.

## Non-goals
Real providers (PayOS/MoMo/VNPay), webhooks, PENDING -> SUCCESS, Order PAID, refunds, PAYMENT_FAILED order
status, provider-side QR cancellation, manual payment status changes, dispensing, push channels, reports, deletes.

## Database impact
NEW V12: UNIQUE (provider, payment_reference) WHERE payment_reference IS NOT NULL. V1-V11 unchanged.
No entity mapping change expected; payments has no updated_at (not added).

## Status and verification (2026-10-15)
Implemented and locally verified; nothing committed, pushed, PR-ed or merged.
- `mvn --batch-mode --no-transfer-progress clean verify` (JDK 21.0.10, Maven 3.9.12, PostgreSQL 18.6 Testcontainers):
  516 tests, 0 failures/errors/skips, BUILD SUCCESS on the final code. Log: backend/target/issue29-verify.log (ignored).
- New classes: PaymentAttemptIntegrationTest(14), PaymentLifecycleIntegrationTest(7, incl. create-vs-cancel and concurrent create races),
  PaymentManagementIntegrationTest(4), PaymentSchemaIntegrationTest(2), PaymentConfigurationTest(5, ApplicationContextRunner startup failures),
  PaymentServiceDocumentationTest(1). Test doubles: ControllableGateway (TESTPAY) measures idle-in-transaction sessions during the provider call.
- Existing tests changed only for new counts/paths (12 migrations, 4 migrations in the V8 upgrade test, exact OpenAPI path lists) and
  ProductionDocumentationTest, which must use a non-MOCK provider because prod rejects MOCK; no assertion weakened.
- V1-V11 checksums asserted unchanged (OrderSchemaIntegrationTest). api-contract/api.yaml regenerated for 6 touched operations plus
  `POST /api/v1/kiosk/orders` (extended KioskOrderResponse), compared with the exposed OpenAPI by PaymentServiceDocumentationTest.
- Limits: Swagger UI verified by automated load/OpenAPI tests only (no manual Try-it-out, no bootRun against a developer database);
  "unknown provider / prod+MOCK fails startup" is verified with ApplicationContextRunner on the real registry, not a full app boot.
  Run Maven with JDK 21 and `clean` (an IDE auto-compiling into target/classes can break runs).
- Design notes: kiosk qrCode is null once an attempt is no longer PENDING; provider call runs on a virtual thread with provider-timeout;
  `orders.expires_at` capped QR deadline; no payment success path exists.

# Testing

## 18. Migration / Configuration Tests

- [x] V12 applies on clean PostgreSQL 18
- [x] Duplicate (provider, payment_reference) is rejected
- [x] Same reference under different providers is allowed
- [x] Flyway validation passes
- [x] Hibernate ddl-auto=validate passes
- [x] Unknown PAYMENT_PROVIDER fails startup
- [x] prod profile with MOCK fails startup
- [x] Invalid payment properties fail startup

## 19. Create Attempt Tests

- [x] Kiosk creates attempt for own PENDING_PAYMENT order -> 201
- [x] Amount equals order.total_amount
- [x] provider, payment_reference, qr_code stored
- [x] expired_at = min(order.expires_at, now + attempt-ttl) (fixed Clock)
- [x] Repeated request returns same attempt -> 200
- [x] Expired PENDING attempt becomes EXPIRED and a new attempt is created
- [x] Attempt in flight (no QR yet) -> 409
- [x] Max attempts reached -> 409
- [x] Order not PENDING_PAYMENT -> 409
- [x] Order hold below min-remaining-hold -> 409
- [x] Other machine's order / missing order -> 404
- [x] Provider failure -> attempt FAILED, response 502, order unchanged
- [x] Provider timeout -> attempt FAILED, response 502
- [x] Provider call happens with no open DB transaction
- [x] Order cancelled during provider call -> attempt stays EXPIRED, response 409
- [x] Request body / amount from client is ignored or rejected

## 20. Lifecycle Integration Tests

- [x] Kiosk cancel -> pending attempts EXPIRED, inventory released
- [x] Expiry sweep -> pending attempts EXPIRED, inventory released
- [x] FAILED / EXPIRED attempts do not change order status
- [x] No code path in this issue produces SUCCESS or order PAID

## 21. Concurrency Tests (real PostgreSQL)

- [x] Two concurrent create requests for one order -> at most one new attempt
- [x] Create attempt vs concurrent cancel -> consistent final state (no PENDING attempt on CANCELLED order)

## 22. Kiosk Polling Tests

- [x] Order response includes latest attempt as currentPayment
- [x] currentPayment = null before any attempt
- [x] Other machine cannot read the order (404)

## 23. Management Tests

- [x] ADMIN can list payments with pagination, filters and sorts
- [x] ADMIN can view payment details (incl. qrCode)
- [x] List does not include qrCode
- [x] Missing payment -> 404
- [x] STAFF -> 403; unauthenticated -> 401; kiosk key -> 401
- [x] Order details include payment summaries (ADMIN and STAFF)

## 24. Documentation / Regression Tests

- [x] Swagger UI shows new tags and endpoints
- [x] api-contract/api.yaml matches exposed OpenAPI
- [x] All existing tests pass (mvn clean verify)
- [x] Order/reservation behavior (#27) unchanged except documented extensions
- [x] Application starts successfully

---

# Acceptance Criteria

The issue is complete when:

- [x] V12 unique (provider, payment_reference) index added
- [x] PaymentGateway abstraction implemented
- [x] Single active gateway selected by configuration
- [x] MockPaymentGateway implemented and forbidden in production
- [x] POST /api/v1/kiosk/orders/{orderId}/payments creates or reuses an attempt
- [x] Amount always comes from the order
- [x] No DB transaction is open during the provider call
- [x] QR never outlives the order reservation
- [x] Provider failure marks attempt FAILED and returns 502
- [x] Order cancel/expiry marks pending attempts EXPIRED
- [x] Kiosk order polling shows current payment
- [x] GET /api/v1/payments and GET /api/v1/payments/{id} work (ADMIN only)
- [x] Order details include payment summaries
- [x] No code path produces payment SUCCESS or order PAID
- [x] Lock order Order -> Payment -> InventoryItem respected and documented
- [x] Existing RBAC and common error handling reused
- [x] Swagger/OpenAPI and api-contract/api.yaml updated and consistent
- [x] .ai/ docs and docs/payment-service.md updated
- [x] Tests pass (mvn clean verify)
- [x] Flyway validation passes
- [x] Hibernate ddl-auto=validate passes
- [x] Existing applied migrations remain unchanged
