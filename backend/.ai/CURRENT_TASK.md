# Issue #35 — [BE] Update orders (single bowl per order, slot-head reservation)

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/35
Branch: feature/35-single-bowl-orders (from origin/dev 903b4af, includes #33 via PR#34)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking the
GitHub checkboxes of this issue is allowed after verification (AGENTS.md section 14).
Note: the issue text refers to #13/#14/#16; in this repository order management is #27 and payments are #29/#31/#33.

## Scope
- Breaking kiosk request: `POST /api/v1/kiosk/orders` takes `{ "productId": "<uuid>" }` only (strict DTO); every new order has one item, quantity 1.
  Response shape and management order APIs unchanged (itemCount/totalQuantity stay, always 1 for new orders).
- Remove `app.order.max-total-quantity` (ORDER_MAX_TOTAL_QUANTITY) and the catalog field `maxTotalQuantity`.
- Slot head = physically present item (AVAILABLE, RESERVED, EXPIRED, DISPENSE_FAILED) with the earliest loaded_at, tie-break id.
  Only a sellable head can be reserved (head AVAILABLE, batch outlives the hold deadline, product/slot/machine ACTIVE, same machine, same product),
  so at most one RESERVED bowl per slot. FEFO only between slot heads (head expiry, head loaded_at, slot_code, slot id).
- Reservation in one transaction with locks Product (share) -> Machine (share) -> candidate Slots (update, sorted by id) -> head Item (update).
- Catalog lists only products with a sellable head; availableQuantity counts AVAILABLE bowls of that product, outliving the hold deadline,
  in slots whose head is sellable for that product (aggregate SQL with DISTINCT ON).
- Optional section 9: headStatus / headExpired on the slot inventory summary.

## Non-goals
Multi-bowl carts, slot position sensors, automatic EXPIRED transitions or blocked-slot alerts, inventory load/remove rule changes,
dispense commands (Milestone 3), kiosk UI, schema changes.

## Database / API impact
No schema change; V1-V12 untouched; no CHECK quantity = 1 (historical rows keep many lines). API: request shape of the kiosk order
endpoint changes, catalog loses maxTotalQuantity, inventory summary gains headStatus/headExpired.

## Status and verification (2026-10-18)
Implemented and locally verified; see HANDOFF.md for Git delivery status.
- `mvn --batch-mode --no-transfer-progress clean verify` (JDK 21.0.10, PostgreSQL 18.6 Testcontainers): 628 tests, 0 failures/errors/skips, BUILD SUCCESS,
  Flyway validated 12 migrations, Hibernate validate passed, zero mentions of api-merchant.payos.vn. A later test-only assertion (summary head fields) was rerun with its classes: 43 tests, 0 failures.
- Evidence: OrderCreationIntegrationTest (request contract, head selection, slot choice), OrderCancelExpiryIntegrationTest (release keeps the head), OrderConcurrencyIntegrationTest
  (one reservation per slot, several columns, race with load and with head removal), KioskCatalogIntegrationTest (blocked heads, counting, maxTotalQuantity gone, summary head fields),
  OrderManagementReadIntegrationTest (historical multi-line orders), payment/webhook suites on one-bowl orders, OrderManagementDocumentationTest and InventoryManagementDocumentationTest (contract).
- Assumption to confirm with the hardware team: columns are refilled from the top (earlier loaded_at = lower position).

# Testing

## 11. Request Contract Tests

- [x] `{ "productId": ... }` creates an order with one item, quantity 1
- [x] Missing / invalid `productId` → `400`
- [x] Old shape `{ "items": [...] }` → `400`
- [x] Extra fields (`quantity`, `price`, `machineId`, `status`) → `400`
- [x] Response has exactly one item; `subtotal = totalAmount = unitPrice`

## 12. Head Selection Tests

- [x] Column with bowls loaded at t1 < t2 < t3 → bowl loaded at t1 is reserved
- [x] Fresher bowl deeper in the column is NOT reserved before the head
- [x] Head RESERVED → slot skipped; second order uses another slot or gets `409`
- [x] Head EXPIRED status → slot blocked, `409` if no other slot
- [x] Head AVAILABLE but batch expired → slot blocked
- [x] Head expiring before `order.expiresAt` → slot blocked
- [x] Head DISPENSE_FAILED → slot blocked
- [x] Slot INACTIVE / ERROR → skipped
- [x] Several sellable slots → slot with earliest head expiry chosen
- [x] SOLD / REMOVED items are ignored when computing the head
- [x] Bowls of the same load (same `loaded_at`) handled deterministically

## 13. Release Tests

- [x] Cancel / expiry returns head to AVAILABLE; it is still the head
- [x] Next order reserves that same bowl again

## 14. Concurrency Tests (real PostgreSQL)

- [x] Two concurrent orders, one slot with ≥ 2 bowls → one `201`, one `409` (one reservation per slot)
- [x] Two concurrent orders, two sellable slots → both succeed on different slots
- [x] Order vs concurrent inventory load into the same slot → consistent head
- [x] Order vs concurrent removal of the head → never reserves a removed bowl

## 15. Catalog Tests

- [x] Product listed only with a sellable head
- [x] Product whose only slot has an expired head is not listed
- [x] `availableQuantity` counts only bowls in slots with sellable heads
- [x] `maxTotalQuantity` no longer present

## 16. Regression / Documentation Tests

- [x] Management order list/detail unchanged in shape; historical multi-item orders still readable
- [x] Inventory load/remove/summary behavior unchanged (except optional §9 fields)
- [x] Payment flow (#14/#16, if delivered) works with single-bowl orders
- [x] `ORDER_MAX_TOTAL_QUANTITY` removed from config and `.env.example`
- [x] Swagger and `api-contract/api.yaml` consistent (documentation test)
- [x] All existing tests pass (`mvn clean verify`)
- [x] Flyway / Hibernate validation pass

# Acceptance Criteria

- [x] Kiosk order request accepts exactly one `productId`
- [x] Every new order has exactly one item with quantity 1
- [x] Only the head bowl of a slot can be reserved
- [x] At most one RESERVED bowl per slot
- [x] Blocked heads (reserved, expired, dispense-failed, expiring during hold) block their slot
- [x] FEFO applied between slot heads only
- [x] Reservation is atomic and concurrency-safe with slot-level locking
- [x] Catalog lists only products with a sellable head
- [x] `max-total-quantity` config and `maxTotalQuantity` field removed
- [x] Management order APIs unchanged in shape
- [x] No schema change; applied migrations unchanged
- [x] `.ai/` docs, `docs/order-management.md`, Swagger and api-contract updated
- [x] Tests pass (`mvn clean verify`)
