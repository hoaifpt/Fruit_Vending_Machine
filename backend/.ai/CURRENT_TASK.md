# Issue #43 — [BE] Implement MQTT Integration Backend

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/43
Branch: feature/43-mqtt-integration (from origin/dev a81f6de, includes #35 via PR#36)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking the
GitHub checkboxes of this issue is allowed after verification (AGENTS.md section 14).
Note: the issue refers to #17/#18/#19/#20/#21/#22 by its own milestone numbering.

## Scope
Inbound-only MQTT boundary: versioned topic/envelope contract (api-contract/mqtt-contract.md), local Mosquitto (auth + ACL, generated
password file ignored by Git), spring-integration-mqtt (Paho v3) client with typed `app.mqtt.*` settings (enabled=false by default),
non-blocking connection lifecycle with retry, subscription to vending/+/{telemetry,status,events}, parsing/validation, machine
resolution by code, dispatch to `MachineMessageHandler` beans, sanitized rate-limited rejection logs, connection state and counters.

## Non-goals
Sensor persistence, last_seen_at, online/offline, alerts, machine_events, duplicate detection, backend-to-machine commands,
dispensing over MQTT, broker account API, production TLS provisioning, shared subscriptions, WebSocket push, firmware/kiosk changes.

## Database / API impact
No schema change (read-only machines lookup by code). No REST/OpenAPI change.
New dependency: org.springframework.integration:spring-integration-mqtt (Boot-managed version, Paho MQTT v3 client).

## Status and verification (2026-10-20)
Implemented and locally verified; see HANDOFF.md for Git delivery status.
- `mvn --batch-mode --no-transfer-progress clean verify` (JDK 21.0.10, Docker 29.1.3, PostgreSQL 18 + eclipse-mosquitto:2 Testcontainers): 678 tests,
  0 failures/errors/skips, BUILD SUCCESS, Flyway validated 12 migrations, Hibernate validate passed, zero payOS calls, test passwords absent from the log.
- New tests: MachineMessageParserTest (28), MachineMessageDispatchTest (7), MqttConfigurationTest (6), MqttContractDocumentationTest (2),
  MqttBrokerIntegrationTest (5: real broker with the committed mosquitto.conf/ACL, three channels, unknown machine, invalid messages, anonymous/wrong
  password/cross-machine ACL, broker restart and reconnect), MqttUnavailableBrokerIntegrationTest (1), MqttDisabledIntegrationTest (1).
- Manual check of the local broker files (scratch copy, fake passwords): generate-passwd.sh, compose up, anonymous publish refused,
  own-topic publish delivered to the backend account, publish to another machine's topic not delivered.
- Dependencies: spring-integration-mqtt (Boot-managed 6.5.8) and org.eclipse.paho.client.mqttv3 1.2.5 (optional in SI 6, not Boot-managed).
- Unrelated pre-existing flake fixed test-only: CoreManagementFlowIntegrationTest set expires_at = DB CURRENT_TIMESTAMP and compared with the JVM clock
  (failed 1 of 4 runs on dev too); it now uses CURRENT_TIMESTAMP - 1 second.
- Design notes: invalid sentAt rejects the message (documented); unknown envelope fields are ignored; adapter never throws (a dropped QoS 1 message is acked);
  reconnect = Paho automatic reconnect with exponential backoff capped by app.mqtt.max-reconnect-delay (SI 6.5 has no recovery interval); prod requires ssl://.

# Testing

## 14. Parser / Validation Tests (unit)

- [x] Valid topic for each channel parsed correctly
- [x] Invalid topic shapes rejected (wrong root, levels, channel)
- [x] Payload size limit enforced
- [x] Invalid JSON / non-object payload rejected
- [x] Missing / invalid `schemaVersion`, `messageId`, `machineCode`, `payload` rejected
- [x] Unsupported `schemaVersion` rejected
- [x] Topic vs envelope machine code mismatch rejected
- [x] `sentAt` optional; invalid `sentAt` rejected or ignored as documented
- [x] `receivedAt` comes from injected `Clock`

## 15. Dispatcher Tests (unit)

- [x] Message routed to handler of its channel
- [x] Missing handler → dropped without exception
- [x] Handler exception caught; next message still processed
- [x] Unknown machine code dropped

## 16. Integration Tests (Testcontainers Mosquitto + PostgreSQL)

- [x] Backend connects with configured credentials
- [x] Message published to `vending/{code}/telemetry` reaches a test handler as `MachineMessage`
- [x] Same for `status` and `events`
- [x] Message for unknown machine is dropped
- [x] Invalid message does not stop subsequent valid messages
- [x] Application starts and REST works when broker is unavailable
- [x] Reconnect after broker restart; messages received again
- [x] `MQTT_ENABLED=false` → no MQTT connection attempted

## 17. Security / Configuration Tests

- [x] Enabled with blank credentials → startup fails safely
- [x] Password never appears in logs or exception messages
- [x] Local broker config denies anonymous clients (manual check documented)
- [x] Sample ACL prevents machine A publishing to machine B topic (manual check documented)

## 18. Regression

- [x] All existing tests pass (`mvn clean verify`)
- [x] Existing tests do not require a broker (MQTT disabled by default in test profile)
- [x] Application starts successfully
- [x] Flyway / Hibernate validation pass

---

# Acceptance Criteria

The issue is complete when:

- [x] MQTT contract documented in `api-contract/mqtt-contract.md`
- [x] Topic identifier decision (machine code) documented
- [x] Local Mosquitto broker with auth + ACL available for development
- [x] MQTT dependency added and justified
- [x] Typed MQTT configuration with safe defaults (`enabled=false`)
- [x] Backend connects, subscribes and reconnects automatically
- [x] Application/REST unaffected when broker is unavailable
- [x] Inbound messages parsed, validated and resolved to a machine
- [x] Invalid messages dropped safely with sanitized logs
- [x] `MachineMessageHandler` extension point and dispatcher implemented
- [x] No business workflow inside MQTT callbacks
- [x] No dispense/payment/order topics
- [x] No schema or REST API change
- [x] No credentials in Git, logs or docs
- [x] Docs and `.ai/` updated
- [x] Tests pass (`mvn clean verify`)

---
