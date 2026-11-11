# Issue #53 — [BE] Implement Machine Heartbeat & Telemetry

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/53
Branch: feature/53-machine-heartbeat-telemetry (from origin/dev 719c4ed, includes #48, #49, #52)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking verified GitHub checkboxes allowed.

## Scope
Heartbeat + telemetry subscriptions, strict envelope validation for every channel, V15 presence/diagnostic columns (read-only on
Machine), forward-only presence updates, derived connectivity (60 s / 180 s), reboot detection and recovery log, telemetry
validation/dedup/throttle/storage, Machine API fields + connectivity filter, latest and history telemetry APIs (tag Machine Health),
domain events (published + logged only).

## Non-goals
Alerts and automatic MAINTENANCE (3.6), status/heartbeat history in machine_events (3.5), dashboards (6.1), reading retention,
push updates, multi-instance dedup, firmware changes.

## Database / API impact
New V15 (V1-V14 untouched). Machine responses + connectivity, lastHeartbeatAt, firmwareVersion, uptimeSeconds, wifiRssi,
freeHeapBytes; `GET /api/v1/machines?connectivity=`; new `GET /api/v1/machines/{machineId}/telemetry/latest` and
`GET /api/v1/machines/{machineId}/telemetry`. Swagger tag Machine Health, api.yaml synced, MQTT contract 1.2.0.

## Status and verification
Done locally, not committed. `mvn clean verify` (JDK 21.0.10, PostgreSQL 18 + Mosquitto 2.0.20 Testcontainers): 730 tests, 0 failures, BUILD SUCCESS.
New: MachineHealthIntegrationTest (35), MqttHealthEndToEndTest (2, real broker with the repo's mosquitto.conf and ACL, real Last Will),
MachineHealthPropertiesTest (2), MachineHealthDocumentationTest (1).

Notes:
- "Heartbeat updates ... in one statement" is shown by the code (one UPDATE ... RETURNING old.* per message) and the tests check
  every field changes together; statements are not counted by a test.
- Payload size: the whole MQTT message (envelope included) is limited to 8 KB.
- PaymentWebhookProcessingIntegrationTest: test-only fix for DB-vs-JVM clock skew (paid_at = GREATEST(now(), created_at));
  it failed once in the full run and passed twice alone; unrelated to #53.
- The Mosquitto image eclipse-mosquitto:2.0.20 (same tag as infra/docker-compose.yml) is pulled by Testcontainers on first run.

# Testing

## 9. Envelope

- [x] Every machine → backend example in `api-contract/mqtt/examples/` is accepted
- [x] Missing / wrong `schemaVersion`, missing `messageId`, missing or mismatched `machineCode`, non-object `payload`, > 8 KB → dropped, no DB change
- [x] Unknown machine code → dropped
- [x] Dispense events still processed (3.3 regression)

## 10. Presence

- [x] Heartbeat updates last_seen_at, last_heartbeat_at and diagnostics in one statement
- [x] Missing wifiRssi / freeHeap stored as NULL
- [x] Invalid heartbeat → nothing updated
- [x] status ONLINE updates presence; status OFFLINE sets last_offline_at only
- [x] last_seen_at never moves backward
- [x] machines.updated_at unchanged
- [x] Concurrent Admin machine update + heartbeat → no lost configuration change, no deadlock

## 11. Connectivity (fixed Clock)

- [x] NEVER_SEEN, ONLINE (≤ 60 s), WARNING (60–180 s), OFFLINE (> 180 s)
- [x] Last Will OFFLINE → OFFLINE immediately; next heartbeat → ONLINE
- [x] Invalid durations fail startup
- [x] Connectivity filter (if implemented) uses SQL and paginates correctly

## 12. Reboot / Recovery

- [x] Uptime decrease publishes MachineRebootDetectedEvent once
- [x] Recovery after > 180 s logged once

## 13. Telemetry

- [x] Valid reading stored with 2-decimal precision and server time
- [x] Temperature-only and humidity-only readings accepted
- [x] Both missing, NaN, out of range → dropped
- [x] Duplicate messageId dropped; readings closer than min-interval dropped
- [x] TelemetryRecordedEvent published after commit

## 14. Read APIs

- [x] Machine list/detail include connectivity + diagnostics
- [x] Latest reading with LOW / NORMAL / HIGH; null when no reading
- [x] History: validation (`400`), DB paging, DESC order, `404` for missing machine
- [x] ADMIN, STAFF allowed; anonymous `401`; kiosk key `401`; role without MACHINE_READ `403`

## 15. End-to-End (Testcontainers Mosquitto + PostgreSQL)

- [x] Publish heartbeat example → machine ONLINE with diagnostics
- [x] Publish Last Will → OFFLINE
- [x] Publish telemetry example → latest API returns it

## 16. Regression

- [x] All tests pass (`mvn clean verify`)
- [x] Swagger, `api.yaml`, `mqtt-contract.md` consistent
- [x] Flyway / Hibernate validation pass

---

# Acceptance Criteria

- [x] Heartbeat and telemetry topics subscribed
- [x] Envelope validated strictly per contract; dispense flow unaffected
- [x] V15 presence/diagnostic columns added and mapped (read-only)
- [x] Heartbeat/status update presence forward-only; Last Will sets OFFLINE immediately
- [x] Connectivity derived (ONLINE / WARNING / OFFLINE / NEVER_SEEN) with 60 s / 180 s thresholds
- [x] Reboot detection event published
- [x] Telemetry validated, deduplicated, throttled and stored
- [x] Machine APIs show connectivity and diagnostics; latest + history telemetry APIs work
- [x] No alerts or automatic status changes in this issue
- [x] Swagger, `api.yaml`, `mqtt-contract.md`, `.ai/` docs updated
- [x] Tests pass (`mvn clean verify`); Flyway / Hibernate validation pass; applied migrations unchanged
