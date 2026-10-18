# Chat handoff - Issue #35, 2026-10-18

Repository C:/Users/north/Documents/School/9/FruitMachine/backend, Spring module backend/.
Issue https://github.com/hoaifpt/Fruit_Vending_Machine/issues/35, [BE] Update orders (one bowl per order, slot-head reservation).
Branch feature/35-single-bowl-orders from origin/dev 903b4af (includes #33 via PR#34).
Git delivery: see the final report; do not assume commit/push/PR/merge happened.

Delivered: kiosk order request is `{ "productId" }` only (breaking, strict DTO; CreateOrderItemRequest and OrderQuantityDeserializer deleted), one item of quantity 1 per order;
reservation of the sellable slot head only (locks Product share -> Machine share -> candidate Slots FOR UPDATE by id -> head item FOR UPDATE), FEFO between heads
(head expiry, head loaded_at, slot_code, slot id), at most one RESERVED bowl per slot; catalog via one DISTINCT ON aggregate listing only products with a sellable head;
`app.order.max-total-quantity` / ORDER_MAX_TOTAL_QUANTITY / catalog maxTotalQuantity removed; optional section 9 done: inventory summary headStatus/headExpired
(REPEATABLE READ). Management order APIs unchanged; historical multi-line orders readable. No schema change, migrations untouched.
Docs: .ai PROJECT/ARCHITECTURE/DATABASE, docs/order-management.md, Swagger (tag changelog) and api-contract/api.yaml; scripts/payment_test_data.py sends the new body.

Verification: `mvn clean verify` 628 tests, 0 failures, Flyway validated 12 migrations, no real payOS call (JDK 21.0.10, PostgreSQL 18.6 Testcontainers).
After that run only a test-only assertion block (summary head fields) was added to KioskCatalogIntegrationTest; that class and InventoryManagementIntegrationTest were rerun (43 tests, 0 failures).
Open: hardware team must confirm the head assumption (columns refilled from the top, earlier loaded_at = lower position); kiosk developer must switch to the new request shape.
Environment: JAVA_HOME=C:/Program Files/Java/jdk-21.0.10, Docker Desktop running, always `mvn clean ...`.
