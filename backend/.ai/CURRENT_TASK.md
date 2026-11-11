# Issue #56 — [BE] Implement Machine Event Logging

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/56
Branch: feature/56-machine-event-logging (from origin/dev d02980a, includes #48, #49, #52, #53)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking verified GitHub checkboxes allowed.

## Scope
V16 (machine_events.source + message_id with CHECKs, partial unique (machine_id, message_id), type/time index, AUDIT_LOG_READ -> ADMIN),
recording of every valid events/status message (source MACHINE, once per messageId, own transaction, never breaks MQTT processing),
recording of 3.3 / 3.4 domain events AFTER_COMMIT (source BACKEND), machine event timeline API (MACHINE_READ), audit log read API
(AUDIT_LOG_READ), append-only repositories, docs/Swagger/api.yaml/mqtt-contract.

## Non-goals
Alerts (3.6), heartbeat/telemetry history, replay, retention/purge, global event search, editing history, frontend timeline.

## Database / API impact
New V16 (V1-V15 untouched). New GET /api/v1/machines/{machineId}/events, GET /api/v1/audit-logs, GET /api/v1/audit-logs/{id}
(tags Machine Events, Audit Log). MQTT contract 1.3.0 (statuses only). New permission AUDIT_LOG_READ (ADMIN).

## Status and verification
Done locally, not committed. `mvn clean verify` (JDK 21.0.10, PostgreSQL 18 + Mosquitto 2.0.20 Testcontainers): 740 tests, 0 failures,
BUILD SUCCESS. Existing fixture in MachineManagementIntegrationTest now inserts its machine_events row as BACKEND (V16 CHECK). New: MachineEventLoggingIntegrationTest (9),
MachineEventLoggingDocumentationTest (1).

Decisions / notes:
- Legacy machine_events rows (none expected; nothing wrote the table before) have no message id: V16 marks them BACKEND.
- events messages: missing/blank eventType stored as UNSPECIFIED, longer than 64 characters truncated to 64; unknown types kept.
- Hibernate @Immutable was tried on MachineEvent/AuditLog and removed: existing writers then failed ("Lock mode not supported").
  Append-only is enforced by the repositories (plain Repository, no update/delete methods) and the single JDBC writer.
- DispenseService publishes DispenseFailedEvent before entering MAINTENANCE, so the timeline reads failure -> maintenance.
- Backend events are written AFTER_COMMIT in REQUIRES_NEW, the same pattern as the existing dispense dispatcher (needs a second pool
  connection briefly; see the #47 load-test finding).

# Testing

## 7. Migration

- [x] V16 applies; Flyway + Hibernate validation pass
- [x] MACHINE row without message_id rejected; BACKEND row without message_id accepted
- [x] Duplicate (machine_id, message_id) rejected by the unique index
- [x] `AUDIT_LOG_READ` seeded for ADMIN only

## 8. Recording Machine Messages

- [x] Each `events` example from `api-contract/mqtt/examples/` stored once with its eventType and payload
- [x] status ONLINE / OFFLINE stored as STATUS_ONLINE / STATUS_OFFLINE
- [x] heartbeat and telemetry NOT stored in machine_events
- [x] Same message delivered twice → one row; dispense handling still idempotent
- [x] Invalid envelope → no row
- [x] Unknown eventType stored (forward compatibility)
- [x] Recorder failure (simulated) → ERROR log, dispense handling still runs, MQTT callback does not throw

## 9. Recording Backend Events

- [x] Each 3.3 / 3.4 domain event creates one BACKEND row after commit
- [x] Rolled-back business transaction → no BACKEND row
- [x] Payload contains ids/reason only (no secrets, no customer contact data)

## 10. Machine Event API

- [x] Filters type / source / from / to; DESC order; DB paging; size limit `400`
- [x] Missing machine `404`
- [x] ADMIN, STAFF allowed; anonymous `401`; kiosk key `401`; role without MACHINE_READ `403`

## 11. Audit Log API

- [x] Rows written by 3.1 / 3.3 visible with old/new values
- [x] Filters and paging work; system rows show userId null
- [x] ADMIN allowed; STAFF `403`; anonymous `401`
- [x] No write endpoints exist

## 12. Regression

- [x] All tests pass (`mvn clean verify`)
- [x] Swagger, `api.yaml`, `mqtt-contract.md` consistent
- [x] Authorization matrix test (3.1) extended with the new endpoints

---

# Acceptance Criteria

- [x] machine_events extended with source + message_id and duplicate protection (V16)
- [x] Every valid machine event and status message logged once
- [x] Backend decisions from 3.3 / 3.4 logged after commit
- [x] Logging never blocks or breaks MQTT processing
- [x] Machine event timeline API (MACHINE_READ)
- [x] Audit log read API (AUDIT_LOG_READ, ADMIN)
- [x] History append-only; no write endpoints
- [x] Docs, Swagger, `api.yaml`, `mqtt-contract.md` updated
- [x] Tests pass (`mvn clean verify`); Flyway / Hibernate validation pass; applied migrations unchanged
