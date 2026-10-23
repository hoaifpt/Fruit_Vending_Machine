# Handoff — authorized purchase dispensing

Date: 2026-10-23, Asia/Bangkok. Direct user request, no GitHub issue assigned.
Branch: feature/connect-purchase-dispensing. Parent: feature/integrate-esp32-firmware
03bec8a806adfd047c335afc79b7893457229130, based on dev a81f6de.
The user explicitly requested this stacked base rather than a fresh dev branch.

## Delivered behavior

Five kiosk-authenticated operations: idempotent prepare/read, pending queue, exclusive
claim and correlated result. Backend derives the reserved slot/item, rejects unpaid,
wrong-machine, expired and conflicting commands. One in-flight command per machine
serializes the shared IR. SUCCESS atomically writes SOLD/DISPENSED/COMPLETED and SALE
history; duplicate evidence never sells twice. Failure/timeout quarantines the bowl and
sets MAINTENANCE; no automatic refund, inventory release or physical resend.
V13 adds per-order uniqueness, dispatch token and paired uint32 counters. V1–V12 unchanged.

The purchase UI keeps polling through PAID/DISPENSING, only confirms receipt at COMPLETED,
shows support on failure and recovers an order pointer after reload. Browser never claims
or sends UART. firmware/tools/dispense_bridge.py uses durable SQLite journal/outbox and
operator-configured slot UUID -> column mapping; it relays original DISPENSE 1/2 exactly
once and retries only HTTP observations. GPIO, firmware source, NVS and CLI are unchanged.

## Final verification

- Java 21.0.12.1, Maven 3.9.11, Docker Engine 29.8.0, PostgreSQL 18.6 Testcontainers.
- `mvn --batch-mode --no-transfer-progress clean verify`: **639 tests, 0 failures,
  0 errors, 0 skipped, BUILD SUCCESS**; final run finished 2026-10-23 12:12 Asia/Bangkok.
- Flyway 13 migrations validated; Hibernate schema validation and upgrade V12 -> V13 passed.
- New suites: DispenseIntegrationTest 9, DispenseMigrationTest 1,
  DispenseStationFlowIntegrationTest 1; all pass. The station flow uses a real random-port
  Spring server, verified TESTPAY webhook, real Python HTTP worker/SQLite/CLI parser and
  simulated UART, never pyserial/USB. History-write failure verifies transaction rollback.
- `npm test`: 37/37 pass; `npm run build`: pass; `npm run lint`: 0 errors, the same
  15 pre-existing admin/UI warnings, no new purchase warnings.
- `npm run test:e2e`: 3/3 Chromium tests pass (wait beyond old PAID auto-return, failure, reload).
- `npm run gen:api`: valid contract, deterministic output, types current.
- `firmware/.venv/Scripts/python.exe -m unittest discover -s firmware/tests -v`: 22/22 pass.
- `firmware/.venv/Scripts/python.exe -m platformio run -d firmware -e esp32dev`: pass,
  RAM 45,908 bytes, flash 874,133 bytes, same ESP32 implementation.
- All 25 Project B asset/snapshot hashes preserved by Git checkout filters across OSes.
- YAML workflow/contract parse and `git diff --check`: pass.
- Chromium Swagger UI loaded on a disposable isolated runtime, OpenAPI returned 200,
  Try it out GET /api/v1/kiosk/dispense-commands without key returned the expected 401.
  Evidence: backend/target/swagger-smoke.json and swagger-smoke.png; isolated server and
  its database were stopped afterward. Test runtime did not import developer .env.

Build log: backend/target/verify-local.log; JUnit reports: backend/target/surefire-reports/.
JDK/Maven used from C:/Users/ltbab/AppData/Local/Temp/fruit-vending-tools; commands set
JAVA_HOME/PATH only for child processes, not global machine configuration. Node 24.21.0,
Python 3.14 and Playwright 1.64.1 were used locally.

## Documentation and API URLs

Main guide: docs/dispense-integration.md. Contract: api-contract/api.yaml.
Development URLs when running with API_DOCS_ENABLED=true: http://localhost:8080/swagger-ui/index.html
and http://localhost:8080/v3/api-docs; production profile still disables both.
Station configuration: firmware/tools/bridge.example.json; copy to ignored bridge.local.json,
set KIOSK_API_KEY separately, verify identity first without --enable-motion. Keep COM4 and
GPIO 18/19/21/22 plus IR 25/26. Never run maintenance controls alongside the paid station.

## Remaining limits and delivery status

- Hardware upload/HIL and physical bowl drop were explicitly declined; ESP32 disconnected.
  No USB was opened. Simulation does not certify physical delivery or exactly-once MCU behavior.
- MCU B still has no persistent commandId deduplication and has one shared IR. UNKNOWN local
  journal entries must be reconciled physically; never delete the journal to retry.
- There is no new manual reconciliation/refund API in this scope. Failure remains quarantined
  until controlled staff intervention; do not simply reactivate a failed machine.
- Closing the kiosk tab before it requests a command leaves PAID authoritative in backend;
  sessionStorage recovery covers reload, not loss of the browser session. Such an interrupted
  purchase needs support; no speculative motor action is inferred from product names.
- CI workflows added/updated; remote CI results remain unverified at this handoff.
- The user authorized grouped commits and push on 2026-10-23. Delivery hashes are recorded in Git history. No PR, issue edit/closure or merge is included.

## Changed files relative to the firmware parent

- `.env.example`
- `.github/workflows/backend-tests.yml`
- `.github/workflows/frontend-tests.yml`
- `README.md`
- `api-contract/api.yaml`
- `apps/web/README.md`
- `apps/web/e2e/purchase.spec.ts`
- `apps/web/package-lock.json`
- `apps/web/package.json`
- `apps/web/playwright.config.ts`
- `apps/web/src/api/schema.d.ts`
- `apps/web/src/kiosk/active-order.ts`
- `apps/web/src/kiosk/api.ts`
- `apps/web/src/kiosk/flow.ts`
- `apps/web/src/pages/PurchasePage.tsx`
- `apps/web/tests/active-order.test.mjs`
- `apps/web/tests/kiosk.test.mjs`
- `apps/web/tsconfig.node.json`
- `backend/.ai/ARCHITECTURE.md`
- `backend/.ai/CURRENT_TASK.md`
- `backend/.ai/DATABASE.md`
- `backend/.ai/HANDOFF.md`
- `backend/.ai/PROJECT.md`
- `backend/src/main/java/com/fruitmachine/backend/config/OpenApiConfig.java`
- `backend/src/main/java/com/fruitmachine/backend/dispense/DispenseOpenApiConfig.java`
- `backend/src/main/java/com/fruitmachine/backend/dispense/controller/KioskDispenseController.java`
- `backend/src/main/java/com/fruitmachine/backend/dispense/dto/DispenseClaimResponse.java`
- `backend/src/main/java/com/fruitmachine/backend/dispense/dto/DispenseCommandResponse.java`
- `backend/src/main/java/com/fruitmachine/backend/dispense/dto/DispenseResultRequest.java`
- `backend/src/main/java/com/fruitmachine/backend/dispense/entity/DispenseCommand.java`
- `backend/src/main/java/com/fruitmachine/backend/dispense/repository/DispenseCommandRepository.java`
- `backend/src/main/java/com/fruitmachine/backend/dispense/service/DispenseProperties.java`
- `backend/src/main/java/com/fruitmachine/backend/dispense/service/DispenseService.java`
- `backend/src/main/java/com/fruitmachine/backend/dispense/service/DispenseTimeoutScheduler.java`
- `backend/src/main/resources/application.yaml`
- `backend/src/main/resources/db/migration/V13__authorize_dispense_dispatch.sql`
- `backend/src/test/java/com/fruitmachine/backend/auth/AuthIntegrationTest.java`
- `backend/src/test/java/com/fruitmachine/backend/dispense/DispenseIntegrationTest.java`
- `backend/src/test/java/com/fruitmachine/backend/dispense/DispenseMigrationTest.java`
- `backend/src/test/java/com/fruitmachine/backend/dispense/DispenseStationFlowIntegrationTest.java`
- `backend/src/test/java/com/fruitmachine/backend/integration/CoreDatabaseIntegrationTest.java`
- `backend/src/test/java/com/fruitmachine/backend/inventory/InventoryHistoryMigrationTest.java`
- `backend/src/test/java/com/fruitmachine/backend/order/OrderSchemaIntegrationTest.java`
- `backend/src/test/java/com/fruitmachine/backend/payment/PaymentSchemaIntegrationTest.java`
- `backend/src/test/java/com/fruitmachine/backend/persistence/EntityMappingTest.java`
- `backend/src/test/java/com/fruitmachine/backend/security/AuthorizationIntegrationTest.java`
- `backend/src/test/java/com/fruitmachine/backend/user/repository/UserRolePersistenceTest.java`
- `docs/dispense-integration.md`
- `firmware/.gitattributes`
- `firmware/.gitignore`
- `firmware/README.md`
- `firmware/docs/REVIEW_AND_RUN_GUIDE.md`
- `firmware/tests/test_dispense_bridge.py`
- `firmware/tools/bridge.example.json`
- `firmware/tools/dispense_bridge.py`
- `firmware/tools/simulate_paid_dispense.py`
