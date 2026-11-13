# Issue #66 — [BE] Implement Work Order Management

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/66
Branch: feature/66-work-orders (from origin/dev e977894, includes #64 via PR #65)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking verified GitHub checkboxes allowed.

## Scope
V20 (work_orders, work_order_alerts, work_order_events append-only, notifications.work_order_id, 4 permissions), workorder package
(lifecycle with versions and one event per action, assignment rules, machine stop on start, completion checks extension point, alert
create/link/unlink/resolve, notifications after commit, overdue job, createBySystem for 4.5/5.2), APIs, alert responses workOrderId/Code,
notification responses workOrderId, machine reactivation guard, docs/Swagger/api.yaml.

## Non-goals
Restock lines (4.4), maintenance plans (4.5), customer report form (5.2), attachments/checklists/time tracking/SLA, email/SMS,
Staff-created work orders, automatic work orders for every alert.

## Status and verification
Done locally, not committed. `mvn clean verify` (JDK 21.0.10, PostgreSQL 18 + Mosquitto 2.0.20 Testcontainers): 799 tests, 0 failures,
BUILD SUCCESS (first full run: one postgres container startup timeout in MachineManagementDocumentationTest, infra; passed alone and in
the rerun). New: WorkOrderIntegrationTest (6), WorkOrderDocumentationTest (1). Updated: counts, permission lists, matrix, notification fields.

Decisions / notes:
- One permission per endpoint (OpenAPI x-required-permission and the URL/method consistency test): /me, detail and events need
  WORK_ORDER_READ_ASSIGNED, which ADMIN also holds; without READ_ALL other people's work orders are 404. start/notes/complete need
  WORK_ORDER_EXECUTE (ADMIN has it too); "Admin may act for the assignee" = holder of WORK_ORDER_MANAGE.
- Machine-stop preconditions (active orders, unfinished dispense) apply only when the start actually stops an ACTIVE machine.
- Stricter CHECKs than the sketch: OPEN can never have an assignee; NULL result_note / cancel_reason fail (COALESCE); time order.
- Cancel keeps alert links as history; only unfinished work orders count as handling an alert.
- 409 codes are the first word of the message (as in #64).

# Testing

## 8. Migration

- [x] Applies; Flyway + Hibernate validation pass
- [x] CHECKs reject DONE without result, CANCELLED without reason, ASSIGNED without assignee
- [x] `work_order_events` UPDATE/DELETE rejected

## 9. Lifecycle

- [x] Create without assignee → OPEN; with assignee → ASSIGNED + notification
- [x] Assign / unassign / reassign (IN_PROGRESS stays IN_PROGRESS)
- [x] Start by assignee → IN_PROGRESS; by other Staff → 404; by Admin → allowed
- [x] Complete requires result note; DONE / CANCELLED final; invalid transitions 409
- [x] Stale version → 409; repeated start → 200 unchanged
- [x] Every action writes one event with actor and status before/after

## 10. Machine Stop

- [x] Start RESTOCK / MAINTENANCE → machine MAINTENANCE; kiosk catalog empty / order creation 409
- [x] Start INCIDENT without stopMachine → machine unchanged; with → MAINTENANCE
- [x] Active orders or unfinished dispense → 409; INACTIVE machine → 409
- [x] Reactivation refused while IN_PROGRESS; allowed after DONE / CANCELLED
- [x] Complete with unfinished maintenance command → 409

## 11. Alerts

- [x] Create from alert → linked, alert ACKNOWLEDGED, priority/type defaults
- [x] Second unfinished WO for same alert → 409; RESOLVED alert → 409
- [x] Complete with resolveLinkedAlerts → alerts RESOLVED; false → unchanged
- [x] Link alert of another machine → 400

## 12. Notifications / Overdue

- [x] Assignment, system creation, completion, cancellation notify the right users once
- [x] Overdue job notifies once; changing due_at re-arms; DONE not notified

## 13. Authorization

- [x] STAFF list only `/me`; `/work-orders` → 403; other's detail → 404
- [x] STAFF cannot create / assign / cancel / edit (403)
- [x] Anonymous 401; kiosk key 401
- [x] Authorization matrix extended

## 14. Regression

- [x] Alert, notification, maintenance command, machine, order tests pass
- [x] All tests pass (`mvn clean verify`); Swagger / `api.yaml` consistent

# Acceptance Criteria

- [x] Admin creates, edits, assigns, cancels work orders of type RESTOCK / MAINTENANCE / INCIDENT
- [x] Staff sees only their work orders, starts and completes them with a result
- [x] Starting RESTOCK / MAINTENANCE (and INCIDENT on request) puts the machine in MAINTENANCE; Admin reactivates only when no work order is in progress
- [x] Work orders can be created from and linked to alerts; completion resolves linked alerts
- [x] Assignment, completion and overdue notifications delivered in the portal
- [x] Full append-only history per work order
- [x] Extension points ready for 4.4, 4.5, 5.2
- [x] Docs, Swagger, `api.yaml`, ERD updated
- [x] Tests pass (`mvn clean verify`); applied migrations unchanged
