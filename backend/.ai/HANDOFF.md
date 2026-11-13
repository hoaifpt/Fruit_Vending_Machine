# Chat handoff - Issue #61, 2026-11-13

Repository C:/Users/north/Documents/School/9/FruitMachine/backend, Spring module backend/.
Issue https://github.com/hoaifpt/Fruit_Vending_Machine/issues/61, [BE] Implement Near-Expiry Discount Pricing.
Branch feature/61-near-expiry-discount from origin/dev edaeaca (includes #59).
Git delivery: see the final report; do not assume commit/push/PR/merge happened.

Delivered: BUSINESS_ZONE (BusinessCalendar), order codes in the business zone, V18 (pricing_settings, discount columns + CHECKs,
PRICING_READ/MANAGE), pricing package (rule, settings service with audit, GET/PUT /api/v1/pricing/near-expiry-discount), price locked
at order creation from the reserved bowl, catalog price of the next FEFO bowl, discount fields on order/inventory responses, orders
filter discounted. Docs: docs/near-expiry-pricing.md, order-management.md, database-migration.md, permission-authorization.md,
.ai/DATABASE.md §21, README, api.yaml.

Verification: `mvn clean verify` 779 tests, 0 failures. Open: sales reports (F-09) do not exist yet; frontend owner must be told
that catalog `price` now means the effective price.
Environment: JAVA_HOME=C:/Program Files/Java/jdk-21.0.10, Docker Desktop running, always `mvn clean ...`.
