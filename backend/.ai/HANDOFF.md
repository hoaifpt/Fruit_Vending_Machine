# Chat handoff - Issue #49, 2026-11-09

Repository C:/Users/north/Documents/School/9/FruitMachine/backend, Spring module backend/.
Issue https://github.com/hoaifpt/Fruit_Vending_Machine/issues/49, [BE] Publish MQTT Contract & Error Code Catalog.
Branch feature/49-mqtt-contract rebuilt from origin/dev e2546e9 (includes #48, merged as PR #50) with the #49 commit cherry-picked;
the old firmware-branch-based version is the local branch backup/49-on-firmware-branch. Firmware on dev is the contract reference.
Git delivery: see the final report; do not assume commit/push/PR/merge happened.

Delivered: api-contract/mqtt-contract.md v1.0.0 + 12 examples (api-contract/mqtt/examples/); constants in backend mqtt/contract/
(MqttContract, MachineChannel, MachineTopic, MachineCommandType, MachineEventType, MachineErrorCode, MachineCommands) used by
MqttMachineGateway, MachineMessageHandler, DispenseService and MqttProperties without behavior change; ACL heartbeat line;
docs/mqtt-dispense.md, backend-machine-health*.md, backend-maintenance-clear-column.md, backend-hardware-integration-tasks.md rewritten
to link the contract; .ai ARCHITECTURE §10, PROJECT §9 and AGENTS §10 point to the contract.

Verification (on dev + #49, 2026-11-10): `mvn clean verify` 665 tests, 0 failures. MqttContractDocumentationTest parses the contract tables against the constants,
examples, docs and ACL; MqttContractExamplesIntegrationTest feeds every inbound example to MachineMessageHandler.
Firmware README linked to the contract (user permission 2026-11-10). Open: firmware owner sign-off (catalog all PROPOSED). #47 JMeter suite still in git stash.
Environment: JAVA_HOME=C:/Program Files/Java/jdk-21.0.10, Docker Desktop running, always `mvn clean ...`.
