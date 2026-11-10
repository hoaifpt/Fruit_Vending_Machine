# Chat handoff - Issue #53, 2026-11-10

Repository C:/Users/north/Documents/School/9/FruitMachine/backend, Spring module backend/.
Issue https://github.com/hoaifpt/Fruit_Vending_Machine/issues/53, [BE] Implement Machine Heartbeat & Telemetry.
Branch feature/53-machine-heartbeat-telemetry from origin/dev 719c4ed (includes #48 PR #50, #49 PR #51, #52 PR #54).
Git delivery: see the final report; do not assume commit/push/PR/merge happened.

Delivered: V15 presence/diagnostic columns (Machine maps them, and last_seen_at, read-only). MachineMessageHandler validates every
envelope (8 KB, JSON, schemaVersion 1, messageId, machineCode = topic, payload object, known machine) and routes events/status/
heartbeat/telemetry. MachinePresenceService: one forward-only UPDATE per message with RETURNING old.* (reboot event, recovery log).
ConnectivityEvaluator (60 s / 180 s, app.machine-health) for responses and the SQL list filter. TelemetryService (validation,
dedup 10 min, min interval 10 s, sensor_readings) and TelemetryQueryService/TelemetryController (latest, history; tag Machine Health).
Events MachineRebootDetected/MachineOfflineReported/TelemetryRecorded logged after commit. Docs: docs/machine-health.md,
mqtt-contract 1.2.0, api.yaml, machine-management.md, database-migration.md, .ai/DATABASE.md §18.

Verification: `mvn clean verify` 730 tests, 0 failures (incl. real Mosquitto end-to-end test). Test-only clock-skew fix in
PaymentWebhookProcessingIntegrationTest. Open: firmware on dev sends no heartbeat/telemetry yet; alerts are 3.6.
Environment: JAVA_HOME=C:/Program Files/Java/jdk-21.0.10, Docker Desktop running, always `mvn clean ...`.
