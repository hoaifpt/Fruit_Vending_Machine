# Issue #52 — [BE] Harden Dispense Command Flow

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/52
Branch: feature/52-harden-dispense-flow (from origin/dev 8ac9c00, includes #48 and #49)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking verified GitHub checkboxes allowed.

## Scope
V14 (slot code = physical column A/B with safe normalization, `dispense_commands.failure_reason` + CHECK + legacy backfill,
in-flight index), `columnCode` in DISPENSE, publish preconditions (machine and slot ACTIVE, no other in-flight command of the
machine) under a per-machine advisory lock, result timeout from first delivery + separate pending timeout, safe vs unsafe failures,
`details.reason` / `details.bowlCount`, late COMPLETED hybrid rule, multi-bowl, `MachineService.enterMaintenanceBySystem`,
domain events (published + logged only).

## Non-goals
Alerts/notifications (3.6), machine event persistence (3.5), maintenance commands and RESET (4.2), refunds (5.1), automatic stock
reconciliation after multi-bowl, firmware changes (columnCode reading, NVS, IR confirmation, reasons), kiosk UI.

## Database / API impact
New V14 (V1-V13 untouched). REST: `POST /api/v1/machines/{id}/slots` accepts slotCode A or B only (400 otherwise); Swagger and
api.yaml updated; order/dispense responses unchanged. MQTT contract 1.1.0 (statuses; no message shape change).

## Status and verification
Done locally, not committed. `mvn clean verify` (JDK 21.0.10, PostgreSQL 18 Testcontainers): 690 tests, 0 failures, BUILD SUCCESS.
New: DispenseFlowIntegrationTest rewritten (29 tests), DispenseHardeningMigrationTest (2, disposable databases at V13).
`db/dev/seed.sql` (run twice) and `db/verify/constraints.sql` were run on a throwaway PostgreSQL 18 with V1-V14 applied: both pass.

Risks / open points:
- **Existing databases with the old dev seed stop at V14** (DEV-MACHINE-01 has A1, A2, B1; A2 names no column). This is the rule of
  the issue (ambiguous data -> stop and report, nothing changed). Before deploying, the owner of that database must rename or remove
  those slots (for example keep A1 -> A, B1 -> B and retire A2 after moving its stock). Dev/staging data was not inspected from here.
- Firmware on dev still reads `column`/`slot`, not `columnCode`: until firmware reads it, every dispense uses column A
  (contract: columnCode FIRMWARE_PENDING).
- BM04 is not in this repository; the new F-03 wording is recorded in docs/mqtt-dispense.md.
- `scripts/payment_test_data.py` now seeds columns A/B (2000/5000 VND; `--fractional` puts 35000.50 in B).

# Testing

## 13. Slot / Migration

- [x] V14 normalizes `A1`/`B1` and adds the CHECK; Flyway + Hibernate validation pass
- [x] Migration stops with a clear error on ambiguous data (test with a disposable DB)
- [x] Creating slot `C` or `A1` → `400`; `a` → normalized `A`
- [x] Legacy FAILED/TIMEOUT rows backfilled; CHECK enforced for new rows

## 14. Command Payload

- [x] Published payload contains `columnCode` equal to the slot code (A and B)
- [x] Payload matches `api-contract/mqtt/examples/command-dispense.json` keys

## 15. Preconditions / Serialization

- [x] Machine MAINTENANCE or slot INACTIVE → command stays PENDING, not published
- [x] Machine back ACTIVE within window → command published
- [x] Two paid orders on one machine → second published only after first ends
- [x] Concurrent sweeps/first-sends never publish two commands of one machine at once

## 16. Timeouts

- [x] Never published for `pending-timeout` → FAILED NOT_DELIVERED, bowl AVAILABLE, allocation RELEASED, order DISPENSE_FAILED, RETURN history
- [x] Published, no result for `timeout` after `sent_at` → TIMEOUT RESULT_TIMEOUT, bowl DISPENSE_FAILED, machine MAINTENANCE
- [x] Resends do not move `sent_at`
- [x] No resend after TIMEOUT/FAILED

## 17. Reasons

- [x] REJECTED BUSY / no reason → resent (backward compatible)
- [x] REJECTED CONTROLLER_FAULT → safe failure + machine MAINTENANCE
- [x] REJECTED INVALID_COLUMN → safe failure, ERROR log, machine unchanged
- [x] ABORTED with each reason / no reason → unsafe failure + machine MAINTENANCE
- [x] Unknown reason value → treated as ABORTED_UNSPECIFIED / BUSY as documented

## 18. Late Result

- [x] Late COMPLETED, order DISPENSE_FAILED → COMPLETED, bowl SOLD, machine stays MAINTENANCE
- [x] Late COMPLETED, order REFUNDED → bowl SOLD, order REFUNDED, audit row
- [x] Late COMPLETED, bowl REMOVED → nothing changes, audit row
- [x] Late COMPLETED after NOT_DELIVERED → nothing changes, audit row
- [x] Duplicate COMPLETED → no second history row

## 19. Multi-bowl

- [x] COMPLETED with bowlCount 2 → order COMPLETED, machine MAINTENANCE, event published, no other bowl changed

## 20. Machine Maintenance by System

- [x] Idempotent; INACTIVE untouched; audit row written
- [x] Kiosk catalog `acceptingOrders=false` afterwards; order creation `409`
- [x] STAFF cannot reactivate (403); ADMIN can

## 21. Regression

- [x] Existing `DispenseFlowIntegrationTest`, payment webhook and order tests pass (fixtures updated to A/B)
- [x] All tests pass (`mvn clean verify`)
- [x] Swagger, `api.yaml`, `mqtt-contract.md` consistent

---

# Acceptance Criteria

- [x] Slots restricted to columns A/B; existing data migrated safely
- [x] Commands carry `columnCode`
- [x] Commands published only when machine and slot are ACTIVE
- [x] At most one in-flight command per machine
- [x] Result timeout measured from first delivery; separate pending timeout
- [x] Safe failures return the bowl; unsafe failures block it and put the machine in MAINTENANCE
- [x] `details.reason` handled per contract; missing reason backward compatible
- [x] `failure_reason` stored on every FAILED/TIMEOUT command
- [x] Late COMPLETED follows the hybrid rule
- [x] Multi-bowl release puts the machine in MAINTENANCE
- [x] Domain events published for 3.5 / 3.6
- [x] Docs and contracts updated; tests pass (`mvn clean verify`)
- [x] Flyway / Hibernate validation pass; applied migrations unchanged
