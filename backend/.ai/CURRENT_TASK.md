# Issue #70 — [BE] Implement Maintenance Scheduling

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/70
Branch: feature/70-maintenance-scheduling (from origin/dev 89d8cb2, includes #68 via PR #69)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking verified GitHub checkboxes allowed.

## Scope
V22 (maintenance_plans, work_orders.maintenance_plan_id + scheduled_for with CHECKs and occurrence / open unique indexes,
MAINTENANCE_PLAN_READ / MAINTENANCE_PLAN_MANAGE), maintenanceplan package (CRUD without delete + audit, upcoming, generate-now,
generator with advisory-locked runs and per-plan transactions, hourly job, next-due listener on completed / cancelled work orders),
WorkOrderService.createScheduled, WorkOrderCancelledEvent, work order responses maintenancePlan / scheduledFor and filter, docs/api.yaml.

## Non-goals
Calendar / cron rules, usage-based triggers, checklists, spare parts, costs, bulk plans, email / SMS, deleting plans.

## Status and verification
Done locally, not committed. `mvn clean verify` (JDK 21.0.10, PostgreSQL 18 + Mosquitto 2.0.20 Testcontainers): 814 tests, 0 failures,
BUILD SUCCESS. New: MaintenancePlanDatesTest (2), MaintenancePlanIntegrationTest (5), MaintenancePlanDocumentationTest (1). Updated:
counts, permissions, matrix; WorkOrderIntegrationTest system work order now CUSTOMER_REPORT (SCHEDULE needs a plan, V22 CHECK).

Decisions / notes:
- createBySystem refuses SCHEDULE; SCHEDULE work orders come only from plans (createScheduled).
- PATCH removes the default assignee with clearDefaultAssignee=true (null means unchanged).
- upcoming includes overdue plans (next due in the past) as well as those due within `days`.
- The job runs every app.maintenance-schedule.interval and 30 s after startup; disabled in the test profile.

# Testing

## 6. Migration

- [x] Applies; Flyway + Hibernate validation pass
- [x] SCHEDULE work order without plan / plan on non-MAINTENANCE type rejected
- [x] Second work order for the same occurrence or second unfinished per plan rejected

## 7. Plan Management

- [x] Admin create / patch / activate / deactivate; each audited
- [x] Invalid interval, lead ≥ interval, past first due date, inactive assignee, inactive machine → 400/409
- [x] Stale version → 409; STAFF read only (write → 403); anonymous / kiosk → 401
- [x] `upcoming` returns plans in range sorted; `overdue` flag correct

## 8. Generation (fixed Clock, real PostgreSQL)

- [x] Due today, lead 0 → one work order, due_at = date at 17:00 VN, source SCHEDULE, scheduled_for set
- [x] Lead 1 → generated one day before
- [x] Default assignee → ASSIGNED + notification; inactive assignee → OPEN + managers notified
- [x] Repeated runs / concurrent runs → still one work order
- [x] Unfinished work order exists → no new one
- [x] Inactive plan or INACTIVE machine → nothing
- [x] Backend down 3 weeks on a 7-day plan → exactly one work order
- [x] One plan failing does not stop others
- [x] generate-now works; with unfinished WO → 409
- [x] Day boundary uses business zone (23:30 VN vs UTC)

## 9. Next Due

- [x] Completed on 20/11 with interval 7 → next 27/11, last_completed_at set
- [x] Completed late on 25/11 → next 02/12
- [x] Cancelled occurrence of 20/11 → next 27/11
- [x] Admin-set later next date kept
- [x] Manual MAINTENANCE work order completion → plan unchanged

## 10. Regression

- [x] Work order, notification, overdue, alert tests pass
- [x] Authorization matrix extended
- [x] All tests pass (`mvn clean verify`); Swagger / `api.yaml` consistent

# Acceptance Criteria

- [x] Admin manages maintenance plans per machine (interval, lead days, due time, priority, default assignee); changes audited
- [x] The system creates exactly one MAINTENANCE work order per due occurrence and notifies the assignee or managers
- [x] Completion sets next due = completion date + interval; cancellation skips to the next occurrence
- [x] Upcoming maintenance view for the next N days
- [x] All dates follow Asia/Ho_Chi_Minh
- [x] Docs, Swagger, `api.yaml`, ERD updated
- [x] Tests pass (`mvn clean verify`); applied migrations unchanged
