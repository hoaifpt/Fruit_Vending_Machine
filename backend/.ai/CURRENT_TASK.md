# Issue #22 — Inventory Management

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/22
Title: [BE] Implement Inventory Management
Branch: feature/22-inventory-management
Base: 5106ea15b5d2c379052a4ae72082ba4a36c85143 (latest fetched dev, PR #23 merged #21).
Clean working tree before branch creation; e9dc20d verified in ancestry.
Implementation and commit/push authorized by user; PR/merge/issue edits not authorized.

## Schema audit before implementation

User specifically required checking real migrations for detailed load/remove history.
V3 inventory_items: batch_id required, slot_id nullable for off-machine legacy inventory,
status and loaded_at/reserved_at/sold_at/removed_at plus created_at/updated_at.
No inventory_items.machine_id. Keep last slot after removal, no hard deletion.
V6 inventory_transactions: id, inventory_item_id required, machine_id/slot_id snapshot,
type, reference_id, performed_by, created_at. Each row is one item, NOT aggregate quantity.
Composite MATCH FULL location FK: both snapshot IDs null or both present. LOAD location required.
Append-only trigger rejects UPDATE/DELETE/TRUNCATE. V7 relevant item/slot/history indexes present.
No reason or before/after status columns existed; no assumption about quantity/batch_id columns.
V9 adds nullable reason VARCHAR500, status_before/status_after VARCHAR24 with enum/nonblank
checks, preserving legacy rows as NULL and the existing trigger/FKs. No invented backfill.
Entity updated to match only these three new columns. Original V1-V8 unchanged.
Per-item LOAD rows share server-generated reference_id operation UUID (not idempotency).
REMOVE records actor, stripped nonblank reason and before/after statuses. Batch via item FK.

## Scope / decisions

Seven issue endpoints plus GET scoped slot inventory/summary for DB-derived stock counts.
ADMIN/STAFF all inventory operations; current JWT actor, strict DTOs/common errors reused.
Load confirms physical work; quantity JSON integer 1..1000 per bounded bulk request (not a
hardware limit). ACTIVE Product/unexpired Batch, ACTIVE Slot, ACTIVE/MAINTENANCE Machine;
INACTIVE Machine rejects loading. No activation, batch/slot/product creation or hardware call.
Locks Product -> Batch -> Machine -> Slot; counts/inserts/history same transaction.
Physical occupancy AVAILABLE/RESERVED/EXPIRED/DISPENSE_FAILED; batch registrations all statuses.
REMOVE allowed AVAILABLE/EXPIRED only, Slot -> Item locks, retains last location; repeated remove
and SOLD/RESERVED/DISPENSE_FAILED reject409. No reconciliation/reservation/sale workflows.
DB pagination page0/size20/max100, approved sorts/UUID tie-break; machine/slot/batch/status/expired
filters and scoped parent checks. To-one entity graphs avoid collection paging/N+1.
Summary separates occupied/available/sellable/expired/reserved/remaining counts; expiry from batch
and Clock, no scheduler/stock counters. Sellable requires ACTIVE Product/Machine/Slot.
Nullable legacy off-machine items/history remain readable; API load always assigns a slot.
No order/payment/dispense/MQTT/sensors/jobs/alerts/dashboard/new dependency.

## Verification status

Implementation and automated/HTTP verification complete locally, 2026-10-10.
- mvn clean verify: 431 tests, zero failures/errors/skips, BUILD SUCCESS.
- Targeted inventory/schema/docs: 41 tests (39 integration + upgrade + contract), all pass.
- Packaged JAR isolated PostgreSQL18 QA on http://127.0.0.1:55190: 36 HTTP/DB checks pass.
  Swagger UI /swagger-ui/index.html and bundle load; /v3/api-docs and swagger-config load;
  8 inventory operations, actual ADMIN/STAFF load/query/summary/remove/history/expiry guards.
- db/verify/constraints.sql updated to expect9 and passes on QA, fixtures ROLLBACK.
- V8->V9 upgrade preserves old fields/NULL unknown facts; append-only trigger still blocks
  UPDATE/DELETE/TRUNCATE. Fresh 9-migration Flyway validate + Hibernate validate pass.
- api-contract/api.yaml matches 8 operations/13 inventory schemas via docs integration test;
  full regression covers all existing documentation/contracts and feature/security suites.
- git diff --check passes; V1–V8 unchanged, 19 business tables; no .env/developer DB change.
- Exact81 checklist items verified against live GitHub issue text/order; no GitHub edits.
- Slot acceptance applies to all items created by load API. Existing schema permits legacy
  off-machine rows; preserving their nullable mapping/history is deliberate and tested.
- Browser kernel startup failed before any page opened. No browser/Try it out claim;
  documentation assets and APIs verified through HTTP, UI interaction remains unverified.
- QA processes/container stopped after verification; development Swagger URLs use port8080.
- Git delivery requested by user after implementation and regression-rule update.
  Branch feature/22-inventory-management, base5106ea15; delivery commit is this snapshot
  (resolve through Git log). No PR/merge/issue edits performed.

Evidence (ignored target/): issue22-verify.log, issue22-http-qa.json,
issue22-constraints.log, inventory-management-openapi.json and surefire-reports/.
Code/tests: inventory/{controller,service,repository,dto,mapper},
src/test/java/com/fruitmachine/backend/inventory/InventoryManagementIntegrationTest.java,
InventoryHistoryMigrationTest.java and InventoryManagementDocumentationTest.java.
Setup/policies: ../../docs/inventory-management.md. No original checklist item remains incomplete.

# 31. Testing

## Inventory Loading Tests

- [x] ADMIN can load inventory.
- [x] STAFF can load inventory.
- [x] Missing ProductBatch returns 404.
- [x] Missing MachineSlot returns 404.
- [x] Inactive Product cannot be loaded.
- [x] Expired batch cannot be loaded.
- [x] Invalid quantity returns 400.
- [x] Slot capacity cannot be exceeded.
- [x] Batch quantity cannot be exceeded.
- [x] Exactly N InventoryItems are created for quantity N.
- [x] Created items have AVAILABLE status.
- [x] Inventory transaction history is recorded.
- [x] Failed loading rolls back all changes.
- [x] Concurrent loading cannot overfill a slot.
- [x] Concurrent loading cannot exceed batch quantity.

## Inventory Query Tests

- [x] ADMIN can list inventory.
- [x] STAFF can list inventory.
- [x] Pagination works.
- [x] Machine filtering works.
- [x] Slot filtering works.
- [x] Batch filtering works.
- [x] Status filtering works.
- [x] Inventory details are returned correctly.
- [x] Missing item returns 404.
- [x] Cross-machine slot access returns 404.
- [x] Expired items are excluded from sellable stock.
- [x] Physical occupancy is calculated correctly.
- [x] Remaining capacity is calculated correctly.

## Inventory Removal Tests

- [x] ADMIN can remove inventory.
- [x] STAFF can remove inventory.
- [x] AVAILABLE → REMOVED works.
- [x] EXPIRED → REMOVED works.
- [x] SOLD → REMOVED is rejected.
- [x] REMOVED → REMOVED is rejected.
- [x] RESERVED → REMOVED is rejected.
- [x] Removal creates inventory transaction history.
- [x] Physical occupancy decreases after confirmed removal.
- [x] InventoryItem is not physically deleted from PostgreSQL.

## Security Tests

- [x] ADMIN can read/write inventory.
- [x] STAFF can read/write inventory.
- [x] Missing JWT returns 401.
- [x] Invalid JWT returns 401.
- [x] Unauthorized roles receive 403.
- [x] Actor identity is obtained from the authenticated principal.

## Regression Tests

- [x] Product Management tests pass.
- [x] Product Batch Management tests pass.
- [x] Machine Management tests pass.
- [x] Machine Slot Management tests pass.
- [x] User/Auth/RBAC tests pass.
- [x] Flyway validation passes.
- [x] Hibernate schema validation passes.
- [x] Application starts successfully.

---

# 33. Acceptance Criteria

The issue is complete when:

- [x] InventoryItem maps correctly to existing `inventory_items`.
- [x] InventoryTransaction maps correctly to existing `inventory_transactions`.
- [x] Every InventoryItem belongs to one ProductBatch.
- [x] Every InventoryItem belongs to one MachineSlot.
- [x] InventoryItemRepository is implemented.
- [x] InventoryTransactionRepository is implemented.
- [x] InventoryService is implemented.
- [x] InventoryController is implemented.
- [x] `GET /api/v1/inventory` works.
- [x] `GET /api/v1/inventory/{id}` works.
- [x] `GET /api/v1/machines/{machineId}/inventory` works.
- [x] `GET /api/v1/machines/{machineId}/slots/{slotId}/inventory` works.
- [x] `POST /api/v1/inventory/load` works.
- [x] `POST /api/v1/inventory/{id}/remove` works.
- [x] `GET /api/v1/inventory/transactions` works.
- [x] One physical box is represented by one InventoryItem.
- [x] Slot capacity is enforced.
- [x] Batch quantity is enforced.
- [x] Concurrent loading is safe.
- [x] Expired inventory is excluded from sellable stock.
- [x] Physical occupancy and available stock are calculated separately.
- [x] Inventory removal preserves history.
- [x] ADMIN/STAFF authorization works.
- [x] Existing common error handling is reused.
- [x] No Order/Payment/Dispense logic is introduced.
- [x] Tests pass.
- [x] Flyway validation passes.
- [x] Hibernate schema validation passes.
- [x] Existing migrations remain unchanged unless a new migration is necessary.

---
