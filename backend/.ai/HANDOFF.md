# Chat handoff — Issue #22, 2026-10-10

Repository C:/Users/north/Documents/School/9/FruitMachine/backend, Spring module backend/.
Issue https://github.com/hoaifpt/Fruit_Vending_Machine/issues/22, [BE] Implement Inventory Management.
Branch feature/22-inventory-management, base 5106ea15b5d2c379052a4ae72082ba4a36c85143.
Delivery commit is this snapshot; resolve its hash and upstream status through Git.
Fetched dev includes #21 via PR #23; e9dc20d ancestor verified, tree clean before branching.
Implementation locally complete. User explicitly requested commit/push of Issue #22
and the regression rule. This snapshot prepares that delivery; verify Git HEAD/upstream
to confirm completion. PR/merge/issue edits remain unauthorized; user merges manually.

User required real schema inspection before implementation. V3/V6/V7 inspected: history per
item with location/actor/reference/time, no quantity/batch/reason/status snapshot columns.
Forward-only V9 adds nullable reason/status_before/status_after, no fabricated legacy backfill.
V1–V8 unchanged, MATCH FULL FK/append-only trigger intact. N LOAD rows share operation UUID,
not an idempotency key. REMOVE records reason/actor/before/after and keeps last location.

Seven required APIs plus scoped slot inventory/summary. ADMIN+STAFF HTTP/service guards.
Load locks Product -> Batch -> Machine -> Slot; all registrations count against batch quantity.
Removal Slot -> Item, AVAILABLE/EXPIRED only. Capacity includes AVAILABLE/RESERVED/EXPIRED/
DISPENSE_FAILED. Load requires active product, unexpired batch, ACTIVE slot, ACTIVE or
MAINTENANCE machine. Summary SQL statement snapshot separates occupancy/availability/
sellability/expiry/reserved/remaining; DB filters/pages, to-one graphs. Legacy off-machine
items remain nullable/readable; all new API loads assign a slot. No future workflows.

Verification:
- mvn clean verify BUILD SUCCESS: 431 tests, no failures/errors/skips (PostgreSQL18).
- Targeted inventory tests41 pass; V8->V9 legacy upgrade/append-only checks pass.
- Packaged JAR QA 36 HTTP/DB checks pass, random HTTP port55190, isolated QA DB.
- Swagger assets/doc/config200, 8 inventory operations; contract8ops/13schemas matches.
- db/verify/constraints.sql PASS, nine-migration guard, fixture ROLLBACK.
- git diff --check clean, no historical migration/.env/developer DB change.
- Exact81 original issue checklist text/order matched live source; CURRENT_TASK all checked,
  with explicit legacy nullable-slot interpretation. No GitHub checkbox edits.
- Browser tool failed kernel/sandbox initialization before opening page; no Try it out claim.
  HTTP docs/API checks substitute only HTTP evidence, not actual UI interaction.
- Owned QA Java launcher/JVM and named container cleaned after tests; no persistent QA server.

Ignored evidence in backend/target/: issue22-verify.log, issue22-http-qa.json,
issue22-constraints.log, inventory-management-openapi.json, surefire-reports/.
Docs: docs/inventory-management.md, database-migration.md, jpa-entities.md; README,
.ai/DATABASE/ARCHITECTURE/PROJECT updated; api-contract/api.yaml additive inventory coverage.
AGENTS.md records actual history schema inspection before coding as persistent user rule.

User subsequently requested a persistent regression-testing rule. AGENTS.md section14
and CODING_RULES.md section30 now require regression testing after bug fixes, features,
performance/refactoring and environment/dependency changes, including full final-code
mvn clean verify and honest reporting of blocked checks. This follow-up only changed
guidance; content/diff checks performed, no application test rerun or Git delivery.

Next authorized step: complete requested commit/push, then await user testing or
manual merge/new instruction. Local Swagger:
http://localhost:8080/swagger-ui/index.html, OpenAPI http://localhost:8080/v3/api-docs.
Use .env/API_DOCS_ENABLED=true and module mvn spring-boot:run (JVM UTC configured).
Direct JAR needs -Duser.timezone=UTC; default Asia/Saigon alias is rejected by PostgreSQL18.
Do not create a PR, merge, edit GitHub issue checkboxes or touch real data without
a new explicit request. The current request authorizes commit/push only.
