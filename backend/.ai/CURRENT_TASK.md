# Issue #64 — [BE] Implement Machine Maintenance Commands

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/64
Branch: feature/64-maintenance-commands (from origin/dev e93882c, includes #61 via PR #63)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking verified GitHub checkboxes allowed.

## Scope
V19 (maintenance_commands with one-unfinished-per-machine index, machine_slots.refill_gate_open, MAINTENANCE_COMMAND_READ /
MAINTENANCE_COMMAND_EXECUTE (ADMIN, STAFF), MACHINE_RESET (ADMIN)), maintenance package (create under locks, dispatcher with re-send
and accept/complete timeouts, MQTT report handling, effects on COMPLETED, reconciliation with audit), RESET, gateway sendMaintenance /
sendReset, dispense waits for unfinished maintenance, refill-gate slots never sell and cannot be activated, slot responses refillGateOpen,
APIs, docs/Swagger/api.yaml/mqtt-contract 1.6.0.

## Non-goals
Restock/loading (4.4), work orders (4.3), scheduling (4.5), firmware RESET handler and NVS, servo test commands, reactivating machines.

## Status and verification
Done locally, not committed. `mvn clean verify` (JDK 21.0.10, PostgreSQL 18 + Mosquitto 2.0.20 Testcontainers): 792 tests, 0 failures,
BUILD SUCCESS (the first full run had one postgres container startup timeout in PaymentManagementIntegrationTest, infra; it passed
alone and in the rerun). New: MaintenanceCommandIntegrationTest (12), MaintenanceCommandDocumentationTest (1). Updated: counts,
permission lists, matrix, slot response field lists, NearExpiryPricingMigrationTest (2 migrations after V17).

Decisions / notes:
- 409 codes are the first word of the message (ApiErrorResponse has no code field; adding one would change every error schema).
- "No unfinished dispense command" = SENT/ACKNOWLEDGED: a PENDING dispense never publishes while the machine is MAINTENANCE.
- 201 returns the command as PENDING; it is published right after commit (AFTER_COMMIT), then the 1 s dispatcher re-sends / times out.
- A maintenance command is only published while the machine is MAINTENANCE; otherwise it stays PENDING until ACCEPT_TIMEOUT.
- Stricter CHECKs than the issue sketch: OTHER needs a non-null note, REMOVE_ITEM/EMPTY_COLUMN need a reason, REMOVE_ITEM needs a target.
- RESET command codes are MC-… (the contract said RS-…; corrected in 1.6.0).
- Open firmware question: EMPTY_COLUMN keeps the upper gate closed; documented (run OPEN_REFILL first) until confirmed.

# Testing

## 8. Migration

- [x] Applies; Flyway + Hibernate validation pass
- [x] Second unfinished command for the same machine rejected by index
- [x] RESET with slot / REMOVE_ITEM without slot rejected; OTHER without note rejected

## 9. Creation Rules

- [x] Machine ACTIVE → 409; INACTIVE → 409; MAINTENANCE → 201
- [x] Offline machine → 409; slot of another machine → 404
- [x] Unfinished dispense or maintenance command → 409
- [x] REMOVE_ITEM: head AVAILABLE / EXPIRED / DISPENSE_FAILED accepted; RESERVED slot → 409; non-head item id → 409; empty slot → 409
- [x] Refill gate open → REMOVE_ITEM / EMPTY_COLUMN / OPEN_REFILL rejected; CLOSE_REFILL allowed
- [x] Idempotency: same key + body → same command; different body → 409
- [x] STAFF cannot RESET (403); anonymous 401; kiosk key 401

## 10. Lifecycle (fake gateway + fixed Clock)

- [x] Publish → SENT; BUSY reject → resend same code; ACCEPTED → ACCEPTED
- [x] No ACCEPTED within 30 s → FAILED ACCEPT_TIMEOUT
- [x] ACCEPTED but no COMPLETED within 90 s → NEEDS_RECONCILIATION
- [x] ABORTED → NEEDS_RECONCILIATION; CONTROLLER_FAULT reject → FAILED
- [x] Late COMPLETED after FAILED / NEEDS_RECONCILIATION → effect applied once
- [x] Wrong event prefix, unknown code, machine mismatch → ignored

## 11. Effects (real PostgreSQL)

- [x] REMOVE_ITEM completed → only the head REMOVED, one REMOVE transaction (reason, actor, reference)
- [x] REMOVE_ITEM on DISPENSE_FAILED head → REMOVED; order/refund untouched
- [x] Head changed before completion → NEEDS_RECONCILIATION, nothing removed
- [x] EMPTY_COLUMN → all physical bowls REMOVED, removed_count correct; SOLD/REMOVED untouched
- [x] OPEN_REFILL / CLOSE_REFILL toggle flag; slot with open gate not in catalog, cannot be activated
- [x] Duplicate COMPLETED → no duplicate transactions
- [x] Dispense creation refused while a maintenance command is unfinished

## 12. Reconciliation

- [x] DONE applies effect; NOT_DONE changes nothing; both audited; second reconcile → 409

## 13. Regression

- [x] Dispense, inventory, catalog, alert, event-logging tests pass
- [x] Authorization matrix extended
- [x] All tests pass (`mvn clean verify`); Swagger / `api.yaml` / `mqtt-contract.md` consistent

# Acceptance Criteria

- [x] Staff/Admin can remove the head bowl, empty a column, open/close the refill gate while the machine is in MAINTENANCE
- [x] Admin can send RESET; FAULT_CLEARED resolves the controller fault alert
- [x] At most one command in flight per machine; dispense and maintenance never overlap
- [x] Inventory changes only on COMPLETED (or reconciliation DONE), exactly once, with REMOVE history
- [x] Aborted / uncertain commands go to NEEDS_RECONCILIATION and are resolved by Staff
- [x] Slots with an open refill gate are never sold
- [x] Idempotent creation; permissions enforced
- [x] Docs, Swagger, `api.yaml`, `mqtt-contract.md`, ERD updated
- [x] Tests pass (`mvn clean verify`); applied migrations unchanged
