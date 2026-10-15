# Issue #27 — [BE] Implement Order Management

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/27
Branch: feature/27-order-management (from origin/dev a3ee8f6, includes #24 via PR#26)
Authorized: implementation and local verification. Commit/push only on request;
no PR/merge/GitHub issue edits.

## Scope
Kiosk machine-bound API key auth (X-Kiosk-Key, SHA-256 hash, one ACTIVE per machine),
ADMIN credential issue/list/revoke, kiosk me/catalog, order create with FEFO atomic
reservation (FOR UPDATE SKIP LOCKED), kiosk read/cancel, scheduled expiry sweep,
ADMIN/STAFF order list/detail. Only PENDING_PAYMENT -> CANCELLED is produced.

## Non-goals
Payments, QR, webhooks, PAID/DISPENSING/COMPLETED, dispense commands, MQTT, refunds,
expiration monitoring, idempotency keys, rate limiting, manual status changes, hard deletes,
kiosk/frontend/firmware changes, refresh tokens.

## Database impact
NEW V10 kiosk_credentials (+ partial unique ACTIVE index); NEW V11 orders.expires_at
(+ CHECK, + partial pending index). V1-V9 unchanged.

## Status and verification (2026-10-15)
Implemented and locally verified; nothing committed, pushed, PR-ed or merged.
- `mvn --batch-mode --no-transfer-progress clean verify` (JDK 21.0.10, Maven 3.9.12, PostgreSQL 18.6
  Testcontainers): 483 tests, 0 failures/errors/skips, BUILD SUCCESS, on the final code.
  Log: backend/target/issue27-verify.log (ignored).
- New classes: KioskCredentialIntegrationTest(7), KioskCatalogIntegrationTest(3), OrderCreationIntegrationTest(8),
  OrderCancelExpiryIntegrationTest(6), OrderManagementReadIntegrationTest(3), OrderConcurrencyIntegrationTest(6),
  OrderSchemaIntegrationTest(4), OrderExpirySchedulerIntegrationTest(1), OrderPropertiesTest(2),
  OrderManagementDocumentationTest(1). Existing tests changed only for new counts (11 migrations, 20 entities,
  21 tables, 3 migrations in the V8 upgrade test, exact OpenAPI path lists); no assertion weakened.
- V1-V9 checksums asserted unchanged. Contract: api-contract/api.yaml synchronized (9 paths, 22 schemas, kioskKey
  scheme, 4 tags) and compared with the exposed OpenAPI by OrderManagementDocumentationTest.
- Limits: Swagger UI is verified by automated load/OpenAPI tests only; no manual Try-it-out and no `spring-boot:run`
  against a developer database. "Application starts" is evidenced by Spring contexts booting on all suites,
  including one with the real scheduler enabled. Run Maven with JDK 21 (default JAVA_HOME here is JDK 25,
  which Lombok cannot compile with).
- Design notes: itemCount in order lists = number of order lines; slot rows are not locked during reservation
  (slot ACTIVE is in the candidate predicate); an order carrying both JWT and kiosk key gets 401.

# Testing

## 30. Migration / Mapping Tests

- [x] V10/V11 apply on a clean PostgreSQL 18 database
- [x] Flyway validation passes
- [x] Hibernate `ddl-auto=validate` passes
- [x] `EntityMappingTest` covers `KioskCredential` and `Order.expiresAt`
- [x] Partial unique index rejects two ACTIVE credentials for one machine
- [x] `ck_orders_expires_at` rejects `expires_at <= created_at`
- [x] V1–V9 remain unchanged

## 31. Kiosk Credential Tests

- [x] ADMIN can issue credential; plaintext key returned once
- [x] Only SHA-256 hash and prefix are stored
- [x] Issuing again revokes the previous ACTIVE credential
- [x] Old key returns `401` after rotation
- [x] ADMIN can list metadata; no hash/secret in response
- [x] ADMIN can revoke; revoke is idempotent
- [x] Revoked key returns `401`
- [x] Credential of another machine returns `404`
- [x] Missing machine returns `404`
- [x] STAFF receives `403` on all credential APIs (including GET)
- [x] Unauthenticated receives `401`

## 32. Kiosk Authentication Tests

- [x] Valid key authenticates as own machine (`/kiosk/me`)
- [x] Missing / malformed / unknown-prefix / wrong-secret key returns `401`
- [x] User JWT on `/api/v1/kiosk/**` returns `403`
- [x] Kiosk key on management APIs returns `401`
- [x] Kiosk of INACTIVE/MAINTENANCE machine can authenticate
- [x] Key never appears in logs (log capture assertion)

## 33. Catalog Tests

- [x] Lists only products with sellable bowls of own machine
- [x] Excludes expired / expiring-before-hold-deadline batches
- [x] Excludes INACTIVE product / slot
- [x] Excludes RESERVED / SOLD / REMOVED / stockroom items
- [x] Does not include other machines' inventory
- [x] Machine not ACTIVE → `acceptingOrders=false`, empty list
- [x] No slot/item/batch identifiers in response

## 34. Create Order Tests

- [x] Creates `PENDING_PAYMENT` order with `expiresAt = now + ttl`
- [x] Prices are snapshotted from product; totals correct
- [x] Reserves exactly the requested quantity per product
- [x] FEFO: earliest-expiring batch reserved first
- [x] Items become `RESERVED` with `reserved_at`
- [x] One `RESERVED` allocation per item
- [x] One `RESERVE` inventory transaction per item with correct snapshot
- [x] Insufficient quantity → `409`, nothing reserved/created (all-or-nothing)
- [x] Unknown product → `404`; inactive product → `409`
- [x] Machine not ACTIVE → `409`
- [x] Duplicate productId / empty items / quantity 0 / fractional / over max → `400`
- [x] Unknown fields (e.g. `price`, `machineId`, `status`) → `400`
- [x] Later product price change does not alter existing order
- [x] Order code format and uniqueness

## 35. Concurrency Tests (real PostgreSQL)

- [x] Two concurrent orders for the last bowl → exactly one `201`, one `409`
- [x] Concurrent orders for N bowls never over-reserve
- [x] Order vs concurrent inventory removal of the same bowl → consistent final state
- [x] Order vs concurrent product deactivation → no order with INACTIVE product reserved after deactivation commit
- [x] Cancel vs expiry sweep on the same order → released exactly once

## 36. Cancel / Expiry Tests

- [x] Kiosk cancel `PENDING_PAYMENT` → `CANCELLED`, `cancelled_at` set
- [x] Cancel is idempotent for `CANCELLED`
- [x] Cancel other machine's order → `404`
- [x] Allocations → `RELEASED` with `released_at`
- [x] Items → `AVAILABLE`, `reserved_at` cleared
- [x] One `RETURN` transaction per item with correct reason
- [x] Sweep expires only `PENDING_PAYMENT` orders past `expires_at` (fixed `Clock`)
- [x] Sweep ignores not-yet-expired orders
- [x] Sweep continues when one order fails
- [x] Released bowl is sellable again (if batch not expired)

## 37. Management Read Tests

- [x] ADMIN and STAFF can list orders
- [x] Pagination, status/machine/date/search filters and approved sorts work
- [x] Details include items, price snapshots and allocations
- [x] Missing order → `404`
- [x] Kiosk key on `/api/v1/orders` → `401`
- [x] No write method exists on `/api/v1/orders/**`

## 38. Documentation / Regression Tests

- [x] Swagger UI loads and shows new tags and both security schemes
- [x] `api-contract/api.yaml` matches exposed OpenAPI (documentation test)
- [x] All existing tests pass (`mvn clean verify`)
- [x] Existing inventory load/remove/summary behavior unchanged
- [x] Application starts successfully

---

---

# Acceptance Criteria

The issue is complete when:

- [x] V10 `kiosk_credentials` migration added and applied
- [x] V11 `orders.expires_at` migration added and applied
- [x] `KioskCredential` entity mapped; `Order.expiresAt` mapped
- [x] Kiosk credential issue/rotate, list, revoke APIs work (ADMIN only)
- [x] Plaintext kiosk key is shown once and never stored
- [x] Kiosk authentication filter works on `/api/v1/kiosk/**` only
- [x] Kiosk machine is derived from credential, never from request
- [x] `GET /api/v1/kiosk/me` works
- [x] `GET /api/v1/kiosk/catalog` returns only sellable products of own machine
- [x] `POST /api/v1/kiosk/orders` creates `PENDING_PAYMENT` order with server-side prices
- [x] Reservation is atomic, all-or-nothing, FEFO, concurrency-safe
- [x] Reserved bowls never expire before `expiresAt`
- [x] RESERVE / RETURN inventory history recorded
- [x] `GET /api/v1/kiosk/orders/{orderId}` works, scoped to own machine
- [x] `POST /api/v1/kiosk/orders/{orderId}/cancel` works and is idempotent
- [x] Expired reservations are released automatically
- [x] `GET /api/v1/orders` and `GET /api/v1/orders/{id}` work for ADMIN/STAFF
- [x] No client can set order status, price or machine
- [x] Only `PENDING_PAYMENT` and `CANCELLED` are produced
- [x] Existing RBAC and common error handling reused
- [x] Swagger/OpenAPI and `api-contract/api.yaml` updated and consistent
- [x] `.ai/` docs and `docs/order-management.md` updated
- [x] Tests pass (`mvn clean verify`)
- [x] Flyway validation passes
- [x] Hibernate `ddl-auto=validate` passes
- [x] Existing applied migrations remain unchanged

---
