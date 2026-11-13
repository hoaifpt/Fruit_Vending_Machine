# Issue #68 — [BE] Implement Restock Workflow

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/68
Branch: feature/68-restock (from origin/dev 2d1043b, includes #66 via PR #67)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking verified GitHub checkboxes allowed.

## Scope
V21 (restock_lines, maintenance_commands.work_order_id, reference_id index, RESTOCK_PLAN / RESTOCK_EXECUTE / INVENTORY_LOAD_DIRECT),
restock package (suggestions from one query, planning on create / from suggestions / line CRUD, loading against a line with FIFO,
expiry-inversion, capacity and batch rules, completion check with variance reasons and closed refill gates, completion summary,
immediate health check after DONE, restock view), work order extension points (creation, start, completion with request + summary,
summary provider, completed event), shared InventoryLoader, maintenance commands with workOrderId, direct load ADMIN only, docs/api.yaml.

## Non-goals
Purchasing/warehouse, automatic restock work orders, multi-machine routes, photos/signatures, undoing loads.

## Status and verification
Done locally, not committed. `mvn clean verify` (JDK 21.0.10, PostgreSQL 18 + Mosquitto 2.0.20 Testcontainers): 806 tests, 0 failures,
BUILD SUCCESS. New: RestockIntegrationTest (6), RestockDocumentationTest (1). Updated: counts, permissions, matrix (baseline line
POST /api/v1/inventory/load STAFF 400 -> 403, deliberate), fixtures that loaded stock as STAFF now load as ADMIN, InventoryManagement
STAFF-load expectations, WorkOrderIntegrationTest RESTOCK orders get a line.

Decisions / notes:
- Loading does not check the refill gate: the loading procedure is not confirmed by the hardware owner; completion requires every gate closed.
- Extension beans are resolved through ObjectProvider in WorkOrderService (restock services use WorkOrderService themselves).
- A line read for the lock order is detached before its row lock (otherwise the lock returns the cached counter: lost update).
- New and re-pointed lines are refreshed after save (read-only slot/product associations).
- Suggestions: INACTIVE slots NONE; expiring-today bowls count as EMPTY_THEN_LOAD (loading on top cannot fix them).
- 409 codes are the first word of the message (as in #64/#66).

# Testing

## 7. Migration

- [x] Applies; Flyway + Hibernate validation pass
- [x] Duplicate (work order, slot, product) rejected; slot of another machine rejected

## 8. Suggestions

- [x] Healthy full slot → NONE; low slot → LOAD with capacity − physical
- [x] Expired / failed / blocked head / expiring today → EMPTY_THEN_LOAD, load = capacity
- [x] Empty slot without history → currentProduct null
- [x] One query (no N+1)

## 9. Planning

- [x] Create RESTOCK with lines; from suggestions → lines + alerts linked
- [x] planned > capacity, inactive product, slot of another machine → 400/409
- [x] Edit/delete line after loading → 409; start RESTOCK without lines → 409
- [x] Line endpoints on MAINTENANCE work order → 400; Staff → 403

## 10. Loading

- [x] Load by assignee on IN_PROGRESS → items, LOAD transactions with reference = line, counter updated
- [x] Not IN_PROGRESS / other Staff → 409 / 404
- [x] Batch of another product, expired batch, capacity, batch quantity → 409
- [x] Earlier-expiring batch on top → 409 EXPIRY_INVERSION; acknowledged → loaded
- [x] Loaded bowls get strictly increasing loaded_at; head after loading into empty column = first loaded
- [x] ERROR slot can be loaded; INACTIVE cannot
- [x] Concurrent loads into the same slot never exceed capacity
- [x] Direct `/inventory/load` by STAFF → 403, ADMIN → works

## 11. Removal Link

- [x] Maintenance command with workOrderId of an IN_PROGRESS WO on the same machine → accepted; other machine / not started → 409
- [x] Removed counts appear in the restock view

## 12. Completion

- [x] All lines match → DONE; variance without reason → 409 listing lines; with reasons → DONE
- [x] Refill gate open → 409
- [x] After DONE: health check run, LOW_STOCK / PRODUCT_* alerts of refilled slots resolved; machine stays MAINTENANCE
- [x] Completion summary in the COMPLETED event

## 13. Regression

- [x] Inventory, catalog (FEFO / head), order, maintenance command, work order, alert tests pass
- [x] Authorization matrix updated (direct load ADMIN only)
- [x] All tests pass (`mvn clean verify`); Swagger / `api.yaml` consistent

# Acceptance Criteria

- [x] Admin gets per-slot restock suggestions and creates a RESTOCK work order with lines (manually or from suggestions)
- [x] Staff loads bowls only through an IN_PROGRESS RESTOCK work order assigned to them; history references the line
- [x] Expiry inversion and capacity / batch rules protect FIFO and stock accuracy
- [x] Removal during restock uses maintenance commands linked to the work order
- [x] Completion requires planned = loaded or a reason per line and closed refill gates; summary recorded
- [x] Stock alerts of refilled slots resolve right after completion
- [x] Direct loading restricted to ADMIN
- [x] Docs, Swagger, `api.yaml`, ERD updated
- [x] Tests pass (`mvn clean verify`); applied migrations unchanged
