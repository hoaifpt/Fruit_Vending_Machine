# Issue #58 — [BE] Alert & Notification Management

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/58
Branch: feature/58-alert-notification (from dev 49e8f17, includes #48, #49, #52, #53, #56)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking verified GitHub checkboxes allowed.

## Scope
V17 (alert slot/error_code/dedupe_key/acknowledgement/resolution note, partial unique open dedupe index, HARDWARE_FAULT, notifications,
ALERT_READ/ALERT_MANAGE -> ADMIN+STAFF, ALERT_NOTIFY -> ADMIN), 60 s health check (offline, temperature/humidity with 5 min grace,
LOW_STOCK <= 2, PRODUCT_EXPIRING 12 h, PRODUCT_EXPIRED, auto-resolve), event alerts (dispense failures, late success, multi-bowl,
FAULT/BOOT/FAULT_CLEARED), notifications for ALERT_NOTIFY users, alert and notification APIs, docs/Swagger/api.yaml/mqtt-contract 1.4.0.

## Non-goals
Email/push/SMS delivery, alert rules editable at runtime, frontend pages, firmware changes (FAULT/BOOT stay FIRMWARE_PENDING).

## Status and verification
Done locally, not committed. `mvn clean verify` (JDK 21.0.10, PostgreSQL 18 + Mosquitto 2.0.20 Testcontainers): 753 tests, 0 failures,
BUILD SUCCESS. New: AlertIntegrationTest (12), AlertNotificationDocumentationTest (1). Updated: migration/table/entity counts, permission
lists and matrix, MachineEventLoggingIntegrationTest (FAULT example now also yields BACKEND_MAINTENANCE_ENTERED),
MachineManagementIntegrationTest fixture (dedupe_key). First full run had one Testcontainers postgres startup timeout (infra), passed on rerun.

Decisions / notes:
- Machine protection (MAINTENANCE) and notifications happen only when an alert is newly created; auto-resolve never re-activates a machine.
- Notification endpoints need only a signed-in user (isAuthenticated()); own rows only, others 404; kiosk keys 401.
- Health check: advisory try-lock for the run, each machine in REQUIRES_NEW; one failing machine is logged and skipped.
- Unknown well-formed FAULT code -> WARNING alert with that code; malformed/missing -> UNKNOWN_FAULT.
- FAULT_CLEARED resolves CONTROLLER_FAULT only; other faults are resolved by staff.
- BM04 is not in the repo; thresholds follow the issue text (F-06, F-07, F-14).

## 9. Migration

- [x] V17 applies; Flyway + Hibernate validation pass
- [x] Two unresolved alerts with the same dedupe_key rejected; resolved + new open allowed
- [x] Slot of another machine rejected by composite FK
- [x] HARDWARE_FAULT accepted; unknown type rejected

## 10. Health Check (fixed Clock, real PostgreSQL)

- [x] OFFLINE machine → one MACHINE_OFFLINE; ONLINE again → auto-resolved
- [x] Temperature out of range shorter than grace → no alert; longer → CRITICAL + machine MAINTENANCE
- [x] Back in range → alert auto-resolved; machine stays MAINTENANCE
- [x] No telemetry → no temperature evaluation
- [x] Slot with 2 sellable bowls → LOW_STOCK; 3 → resolved
- [x] Bowl expiring in 11 h → PRODUCT_EXPIRING; expired bowl → PRODUCT_EXPIRED; removed → resolved
- [x] INACTIVE machines skipped
- [x] Repeated runs create no duplicates; one machine's failure does not stop others
- [x] Overlapping runs prevented

## 11. Event-based Alerts

- [x] Unsafe dispense failure → CRITICAL DISPENSE_FAILED; safe → WARNING
- [x] Late success → that alert auto-resolved
- [x] Each FAULT code → mapped severity and machine action
- [x] Unknown FAULT code → WARNING with code or UNKNOWN_FAULT
- [x] BOOT WATCHDOG → WARNING; BOOT POWERON → no alert
- [x] FAULT_CLEARED resolves CONTROLLER_FAULT only
- [x] Duplicate FAULT message → one alert

## 12. Notifications

- [x] New alert → one notification per ACTIVE user with ALERT_NOTIFY; STAFF none by default
- [x] Existing open alert (dedupe) → no new notification
- [x] Auto-resolve → no notification
- [x] List / unread-count / read / read-all work; other user's notification → 404

## 13. Alert APIs

- [x] Filters, default status filter, severity-first ordering, DB paging
- [x] Acknowledge / resolve transitions; RESOLVED → 409; acknowledge twice idempotent
- [x] Concurrent resolve + auto-resolve → consistent single resolution
- [x] ALERT_READ / ALERT_MANAGE enforced; anonymous 401; kiosk key 401

## 14. Regression

- [x] Dispense, telemetry, event logging tests pass
- [x] Authorization matrix extended with new endpoints
- [x] All tests pass (`mvn clean verify`); Swagger / `api.yaml` / `mqtt-contract.md` consistent

---

# Out of Scope

- Email, SMS, mobile push, WebSocket push
- Work orders from alerts → 4.3
- Payment anomaly alerts
- Escalation, on-call schedules, alert muting
- Per-machine staff assignment / filtering
- Retention / purge of alerts and notifications

---

# Acceptance Criteria

- [x] V17 adds alert columns, dedupe index, HARDWARE_FAULT, notifications, permissions
- [x] Health check runs every 60 s and raises/auto-resolves all state-based alerts of §2
- [x] Temperature breach after grace raises CRITICAL and puts the machine in MAINTENANCE (F-06)
- [x] LOW_STOCK (≤ 2) and PRODUCT_EXPIRING (12 h) thresholds per F-07
- [x] Dispense failures and machine faults raise alerts with error codes (F-14)
- [x] No duplicate open alerts; each new alert notifies Admins once
- [x] Alert list/detail/acknowledge/resolve and notification APIs work with permissions
- [x] Docs, Swagger, `api.yaml`, `mqtt-contract.md`, ERD updated
- [x] Tests pass (`mvn clean verify`); Flyway / Hibernate validation pass; applied migrations unchanged

---

# Definition of Done

```text
Machine problem (offline, hot, faulty, empty, expiring, jam)
   → exactly one OPEN alert with type + error code
   → machine protected (MAINTENANCE) when it is unsafe to sell
   → Admins see a notification in the portal
   → Staff/Admin acknowledge and resolve, or the system resolves when it clears
```

