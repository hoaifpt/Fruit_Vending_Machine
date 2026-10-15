# Chat handoff - Issue #27, 2026-10-15

Repository C:/Users/north/Documents/School/9/FruitMachine/backend, Spring module backend/.
Issue https://github.com/hoaifpt/Fruit_Vending_Machine/issues/27, [BE] Implement Order Management.
Branch feature/27-order-management from origin/dev a3ee8f6 (includes #24 via PR#26).
Git delivery: NOTHING committed or pushed; no PR, merge or GitHub issue edit. All changes are in the working tree.

Delivered: V10 kiosk_credentials, V11 orders.expires_at; kiosk X-Kiosk-Key auth filter and ADMIN credential
issue/list/revoke; kiosk me/catalog; order create with FEFO SKIP LOCKED reservation, kiosk read/cancel, scheduled
expiry sweep (app.order.*); ADMIN/STAFF read-only order list/detail; OpenAPI examples, api-contract/api.yaml,
docs/order-management.md, .ai/DATABASE|ARCHITECTURE|PROJECT. Only PENDING_PAYMENT -> CANCELLED is produced.

Verification: clean verify 483 tests, 0 failures, BUILD SUCCESS (JDK 21.0.10, PostgreSQL 18 Testcontainers).
All 97 CURRENT_TASK checklist items checked. Not done: manual Swagger Try-it-out, bootRun against a dev database.
Environment: use JAVA_HOME=C:/Program Files/Java/jdk-21.0.10 (JDK 25 default breaks Lombok); Docker Desktop must run.

Open decision: itemCount in GET /api/v1/orders is the number of order lines, not total bowls.
Next authorized step: await user review; commit/push/PR only on explicit request. Payment issues (#14-#16 in the issue text)
build on Order -> Payment -> InventoryItem lock order documented in DATABASE.md section 11.
