# Issue #49 — [BE] Publish MQTT Contract & Error Code Catalog

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/49
Branch: feature/49-mqtt-contract, rebuilt 2026-11-10 from origin/dev e2546e9 (includes #48) by cherry-picking the #49 commit
(user decision; the first version was based on the unmerged firmware branch and is kept locally as backup/49-on-firmware-branch).
The four MQTT docs to clean up existed only on feature/firmware-staff-refill-and-maintenance; they are added to dev in their #49 form.
Firmware on dev (b301fd1) is the contract reference: it reads `column`/`slot` (not `columnCode`), sends no heartbeat and has no
maintenance commands, so those contract items are PLANNED until the firmware branch is merged.
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking verified GitHub checkboxes allowed.

## Scope
`api-contract/mqtt-contract.md` v1.0.0 (topics, envelope, commands, events, status/heartbeat/telemetry, error code catalog,
delivery semantics, security, implementation status per message), 12 examples in `api-contract/mqtt/examples/`, backend constants
in `mqtt/contract/` used by the gateway, handler and DispenseService (no behavior change), ACL heartbeat line, docs cleanup.
Reference firmware: dev (b301fd1); where the contract and that firmware differ, the code is described and the item is marked
PENDING/PLANNED. Maintenance cycles are documented from the firmware branch 737b7b9.

## Non-goals
Heartbeat/telemetry processing (3.4), event persistence (3.5), alerts (3.6), columnCode/slot A-B/serialization (3.3),
maintenance + RESET in the backend (4.2), TLS (3.7), firmware changes, AsyncAPI or new dependencies.

## Database / API impact
No schema change, no REST change.

## Status and verification
Rebuilt on dev 2026-11-10. `mvn clean verify` (JDK 21.0.10, PostgreSQL 18 Testcontainers): 665 tests, 0 failures, BUILD SUCCESS.
New tests: MqttContractDocumentationTest (8), MqttContractExamplesIntegrationTest (2). Existing DispenseFlowIntegrationTest (6) and
MqttEnabledStartupTest pass unchanged.
Behavior note: topic parsing now splits with limit -1, so `a/b/c/` counts as 4 levels; such a topic cannot match the
`vending/+/events|status` subscriptions, so runtime behavior is unchanged.
2026-11-10 (user permission): firmware/fruit/README.md now links the contract and states the real columnCode fallback ("A");
MqttContractDocumentationTest (8/8) checks the link; covered by the full verify above.
Open: firmware owner sign-off (all catalog codes PROPOSED with reason).

# Testing

## 13. Contract Consistency

- [x] Every example in `api-contract/mqtt/examples/` is valid JSON with a valid envelope
- [x] Every machine → backend example is accepted by `MachineMessageHandler` without exception (unknown-but-valid types ignored)
- [x] `command-dispense.json` matches the envelope/payload keys produced by `MqttMachineGateway`
- [x] Constants (channels, event types, reasons, codes) equal the values listed in the contract (documentation test)
- [x] Topic parsing rejects 2- and 4-level topics and a topic/envelope machine code mismatch

## 14. Documentation

- [x] No remaining `fruit-vending/` topic anywhere in `docs/`
- [x] Each MQTT doc links to the contract instead of redefining payloads
- [x] Broker ACL includes `heartbeat` and `telemetry` write topics per machine

## 15. Sign-off

- [ ] Firmware owner reviewed the contract — needs the firmware owner in the issue discussion
- [x] Each catalog entry marked `AGREED` or left `PROPOSED` with a reason

## 16. Regression

- [x] All existing tests pass (`mvn clean verify`)
- [x] Dispense flow unchanged (existing dispense tests)

---

# Acceptance Criteria

- [x] `api-contract/mqtt-contract.md` v1.0.0 published with topics, envelope, commands, events, payloads, timings, security
- [x] Error code catalog (reasons, fault codes, reset reasons) included with AGREED/PROPOSED status
- [x] Implementation status stated for every message
- [x] Example messages under `api-contract/mqtt/examples/`
- [x] Backend constants match the contract and are verified by tests
- [x] Outdated MQTT docs cleaned up and linked to the contract (docs/, .ai, AGENTS, firmware README)
- [ ] Firmware owner sign-off recorded
- [x] No runtime behavior change; tests pass (`mvn clean verify`)
