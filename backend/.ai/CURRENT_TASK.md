# Direct user request — connect purchase to authorized dispensing

Date: 2026-10-23, Asia/Bangkok. No GitHub issue assigned; do not invent a number.
Branch: feature/connect-purchase-dispensing. Parent: feature/integrate-esp32-firmware
03bec8a806adfd047c335afc79b7893457229130 (based on dev a81f6de).

## Authorized scope
Backend API/schema/contracts, frontend purchase integration, host Serial bridge and tests.
The latest request supersedes the earlier firmware-only restriction for this work.
ESP32 GPIO/actuator logic/CLI remain unchanged; no hardware upload or servo motion.
The user authorized grouped commits and push on 2026-10-23. PR creation and merge remain outside this request.

## Implementation
- [x] Five machine-scoped operations: prepare/read/pending/claim/results.
- [x] One command per order; exclusive dispatch claim; paired IR observation evidence.
- [x] Atomic SOLD/DISPENSED/COMPLETED/history; timeout quarantine and no blind resend.
- [x] Forward-only V13; V1–V12 untouched.
- [x] UI PAID/DISPENSING/COMPLETED/support and reload using only an order pointer.
- [x] Host journal/outbox and explicit slot UUID mapping, unchanged Project B protocol.
- [x] OpenAPI, generated frontend types, Swagger examples and integration guide.

## Final verification — 2026-10-23
- [x] Focused backend dispensing tests and contract smoke on PostgreSQL 18.
- [x] Frontend 37 unit tests/build/lint and three Chromium purchase tests.
- [x] 22 firmware/host tests, including source parity, no USB.
- [x] Final mvn clean verify: 639 tests, 0 failures/errors/skips; V13/Hibernate validation, upgrade, rollback and real station HTTP/simulated UART passed.
- [ ] Hardware upload/HIL: user declined, ESP32 disconnected.
- [x] Swagger UI Chromium Try it out: GET pending commands without key returned 401 on isolated runtime; backend/target/swagger-smoke.json.

Final commands/results are recorded in HANDOFF.md. Remote CI results remain unverified; local verification results are recorded below.
