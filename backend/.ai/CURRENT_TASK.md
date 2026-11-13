# Issue #59 — [DevOps] Enable MQTT TLS

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/59
Branch: feature/59-mqtt-tls (from origin/dev 9da3406, includes #58 via PR #60)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking verified GitHub checkboxes allowed.

## Scope
Broker: infra/mosquitto/mosquitto.staging.conf (TLS 1.2+ on 8883, 1883 on the container loopback only, log to stderr),
infra/docker-compose.staging.yml (publishes only 8883, mounts /etc/fruit-mqtt/certs read-only), add-user.sh, renew-hook.sh (certbot
deploy hook), README. Backend: MqttProperties require-tls / truststore-path / truststore-password with startup validation and masked
toString, MqttTlsSocketFactory (TLS 1.3/1.2, optional PKCS12 truststore), gateway hostname verification and TLS failure WARN logs,
application-staging.yaml, compose.yaml passes the MQTT variables. Docs: mqtt-contract 1.5.0 §8.1, infra/mosquitto/README.md (incl.
firmware handoff and private-CA fallback), root README staging env list, .ai CODING_RULES / ARCHITECTURE, docs/mqtt-dispense.md.

## Non-goals
Mutual TLS, TLS on the local broker, production, WebSocket MQTT, certificate expiry alerting, firmware implementation.

## Status and verification
Done locally, not committed. `mvn clean verify` (JDK 21.0.10, PostgreSQL 18 + Mosquitto 2.0.20 Testcontainers): 763 tests, 0 failures,
BUILD SUCCESS. New: MqttTlsPropertiesTest (6), MqttTlsIntegrationTest (4, runs the committed staging config with test-only certs from
src/test/resources/mqtt-tls). No test password appears in the build log or surefire output.

Decisions / notes:
- Let's Encrypt chosen (ESP32 embeds ISRG Root X1); private CA documented as fallback (truststore via MQTT_TRUSTSTORE_PATH).
- MqttProperties is bound only when MQTT is enabled, so require-tls is enforced whenever the backend actually uses MQTT.
- Staging config logs to stderr: with stdout mosquitto block-buffers without a TTY and connection logs appear late.
- Broker reload after renewal = container restart (certain to load the new certificate; clients reconnect).
- The .sh files need the executable bit in Git (git add --chmod=+x) when committing.
- Not verified here (need the staging host / firmware): §8 manual checklist, local `docker compose up` was not re-run (local files unchanged).

# Testing

## 7. Backend (automated)

- [x] Properties: `require-tls=true` + `tcp://` → startup fails with a clear message
- [x] Properties: unknown scheme rejected; missing truststore file rejected
- [x] Testcontainers Mosquitto with a TLS listener (test-only CA + server cert in `src/test/resources/mqtt-tls/`, clearly marked as test material):
  - [x] backend connects with `ssl://` + test truststore, subscribes, publishes DISPENSE, receives an event
  - [x] untrusted CA → connection refused, retry loop keeps running, no crash
  - [x] hostname mismatch → connection refused
- [x] No password / truststore password in captured logs
- [x] Existing MQTT and dispense tests pass with `tcp://` (local default unchanged)

## 8. Staging (manual checklist, recorded in the PR)

- [ ] `openssl s_client -connect mqtt.<domain>:8883 -servername mqtt.<domain>` → valid chain, TLSv1.2/1.3
- [ ] `mosquitto_pub --cafile … -p 8883` with machine account → accepted; wrong password → refused
- [ ] Port 1883 from outside the host → connection refused / filtered
- [ ] Machine account cannot publish to another machine's topics (ACL)
- [ ] Backend on staging logs "MQTT connected to ssl://…"
- [ ] ESP32 (once firmware done) connects over 8883; one end-to-end order dispenses
- [ ] Packet capture (Wireshark) shows no readable MQTT payload or credentials
- [ ] `certbot renew --dry-run` runs the deploy hook and the broker keeps serving the new certificate

## 9. Regression

- [ ] Local `docker compose up` (1883, no TLS) still works for development
- [x] All tests pass (`mvn clean verify`)

# Acceptance Criteria

- [ ] Staging broker accepts MQTT only over TLS on 8883 with a valid certificate for `mqtt.<staging-domain>`
- [ ] Plaintext 1883 not reachable from outside the staging host
- [ ] Certificate renewal automated and reloads the broker
- [x] Backend connects over `ssl://` with hostname verification; refuses to start on staging without TLS
- [x] Optional custom truststore supported for a private CA
- [x] ACL includes heartbeat topic; machine accounts isolated
- [x] No secrets or private keys in Git, logs or CI output
- [x] README, `mqtt-contract.md`, `.ai/` guidance updated; firmware handoff published
- [x] Tests pass (`mvn clean verify`)
