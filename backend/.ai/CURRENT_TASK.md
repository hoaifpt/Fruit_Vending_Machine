# Issue #21 — Product Batch Management

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/21
Title: [BE] Implement Product Batch Management
Branch: feature/21-product-batch-management
Base: 71a01ac00a28dea259200d948f6e2f2085e8d904 (latest origin/dev, 2026-10-10).
User manually tested and merged #18 via PR #20; 217f65e verified in ancestry.
Implementation and #21 commit/push explicitly authorized by the user.
No PR/merge/issue edits authorized; user handles merges manually.

## Scope / decisions / database

Three APIs: POST/GET /api/v1/product-batches and GET /api/v1/product-batches/{id}.
ADMIN and STAFF create/read. Reuse ProductBatch under product.entity, add product.batch
API layers; no entity relocation/schema/migration/dependency change.
Code client-supplied, strip/uppercase, globally unique, immutable, max64.
Existing ACTIVE product required; row lock serializes with Product status/config writes.
Creator resolved from existing AuthenticatedUser/SecurityContext and UserRepository.
Positive 32-bit integer quantity is declared production quantity, never current stock.
Offset ISO timestamps normalized to Instant UTC, truncated to microseconds before date
validation; expiry strictly after manufacture and injected Clock's current instant.
Database pagination, page0/size20/max100, exact productId filter; unknown filter empty.
Approved sorts id/batchCode/manufacturedAt/expiresAt/quantity/createdAt, default createdAt,desc
with UUID ascending tie-break. To-one product entity graph avoids N+1/collection paging.
Response includes current product SKU/name, creator UUID (legacy nullable), UTC timestamps.
No PUT/PATCH/DELETE. Expired and inactive-product batches remain readable.
No inventory creation/calculation/lifecycle/location, hardware/MQTT/payment/order/dispense,
expiration alerts/jobs, editing/deletion or optional expiration-state filter.

## Verification status

Implementation complete against all 74 original source checklist items below.
User explicitly requested #21 commit/push on 2026-10-10. Delivery commit:
feat: implement product batch management (#21), branch feature/21-product-batch-management.
Verify final hash/publication with Git refs. No PR/merge/GitHub issue edits authorized or performed.

- Java 21.0.10 / Maven 3.9.12, mvn clean verify BUILD SUCCESS, 2026-10-10 14:53:07 +07:00.
  390 tests, zero failures/errors/skipped. Batch: 38 integration + 1 documentation.
  All prior Product/Machine/Slot/User/Auth/RBAC/bootstrap/entity tests passed.
- PostgreSQL18 Testcontainers applied/validated Flyway V1-V8; Hibernate ddl-auto=validate
  initialized; EntityMappingTest verifies existing schema mappings. No migration/entity/
  enum/pom change or developer DB/.env modification.
- ProductBatchManagementIntegrationTest verifies both roles creating/reading, normalized
  globally unique code, DB UNIQUE race (201/409), authenticated creator and spoof rejection,
  positive strict JSON quantity bounds, required/unknown fields, active/existing product,
  expiration vs manufacture/current injected Clock including equality/microsecond boundaries,
  UTC/offset semantics, product/creator/quantity persistence and DB-generated createdAt.
  Product deactivation race serialized by the existing row lock and rejected with 409.
  DB paging/filter/sort, one to-one product query per page, missing/invalid IDs, safe DTOs,
  legacy null creator, read history after expiry/product deactivation, related inventory
  fixture changes preserve original quantity, no automatic items/slot changes and no
  PUT/PATCH/DELETE endpoints. Real JWT current roles/account state and direct service guards.
- ProductBatchManagementDocumentationTest verifies Swagger HTML/config/OpenAPI, compares
  full Batch operations/parameters/requests/schemas/responses/headers/examples/security
  with api-contract/api.yaml, checks required fields/bounds/DTO shape and resolves refs.
  Contract additions only: Product Batches tag, two paths/three operations/five schemas.
  Existing feature documentation consistency tests and production docs policy pass.
- Packaged JAR with disposable PostgreSQL18, .env import disabled, localhost random port:
  30 HTTP checks passed. Swagger HTML/CSS/JS/initializer/config/OpenAPI all 200; 3 operations.
  Real ADMIN/STAFF logins, both roles POST201 with proper actor, list/detail200, product
  filtering/page200, duplicate/inactive409, spoofed creator/expired/fractional quantity400,
  missing product/batch404, anonymous401, PUT/PATCH/DELETE405. Inactive-product batch readable.
  DB after QA: two batches, zero InventoryItems, zero MachineSlots.
- Actual verified QA URLs: http://127.0.0.1:50758/swagger-ui/index.html and
  http://127.0.0.1:50758/v3/api-docs. QA JAR PID6116/launcher19396 and exact container
  fvm-issue21-qa (51e46c73...) cleaned up; URLs no longer live. User processes/data untouched.
- Browser rendering/Swagger Try it out remains unverified: cua_repl initialization failed
  before opening a browser, with Windows sandbox helper_unknown_error/setup refresh errors.
  HTTP assets/MockMvc/live REST checks do not prove browser interaction. Manual UI follow-up:
  run locally, Authorize with an isolated token, Try GET product-batches; use future expiry
  and disposable product/batch for POST. All original source items supported by tests above;
  this separate UI tooling limitation is explicitly disclosed.
- Local setup: existing .env/PostgreSQL, API_DOCS_ENABLED=true, valid JWT_SECRET; run from
  backend module: mvn spring-boot:run '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC'.
  Swagger http://localhost:8080/swagger-ui/index.html, OpenAPI http://localhost:8080/v3/api-docs.
  Production documentation disabled under existing configuration.
- Ignored backend/target evidence: issue21-verify.log, issue21-targeted.log,
  issue21-qa.stdout.log/issue21-qa.stderr.log, issue21-http-qa.py/issue21-http-qa.json,
  product-batch-management-openapi.json, surefire-reports and packaged JAR.
- git diff --check passed; current user request authorizes commit/push for #21.
  Verify clean working tree and matching remote HEAD after delivery.
  Only backend API layers/security/docs/OpenAPI/tests and root README/contract changed.

## Original source checklist

# Testing

## Create Batch

Verify:

- [x] ADMIN can create batch
- [x] STAFF can create batch
- [x] Product must exist
- [x] Product must be ACTIVE
- [x] Batch code must be unique
- [x] Batch code normalization works if adopted
- [x] `quantity > 0`
- [x] `expiresAt > manufacturedAt`
- [x] Already-expired batch is rejected
- [x] `createdBy` comes from authenticated user
- [x] Client cannot impersonate `createdBy`
- [x] Unauthenticated request receives `401`

---

## List Batches

Verify:

- [x] ADMIN can list batches
- [x] STAFF can list batches
- [x] Pagination works
- [x] Product filtering works
- [x] Only DTOs are returned
- [x] No User entity/security data is exposed
- [x] Unauthenticated request receives `401`

---

## Get Batch

Verify:

- [x] ADMIN can retrieve batch
- [x] STAFF can retrieve batch
- [x] Missing batch returns `404`
- [x] Product information is mapped correctly
- [x] Creator ID is returned correctly
- [x] No recursive entity serialization occurs

---

## Immutability

Verify:

- [x] No general batch update endpoint exists
- [x] No hard-delete endpoint exists
- [x] Creating a batch does not modify Product
- [x] Creating a batch does not create InventoryItems
- [x] Creating a batch does not modify MachineSlot

---

## Persistence

Verify:

- [x] Product relationship persists correctly
- [x] createdBy relationship persists correctly
- [x] timestamps preserve expected timezone semantics
- [x] quantity persists correctly
- [x] unique batch code constraint works

---

## Regression

Verify:

- [x] Product Management tests still pass
- [x] Machine Management tests still pass
- [x] Machine Slot tests still pass
- [x] User/Auth/RBAC tests still pass
- [x] Flyway validation passes
- [x] Hibernate `ddl-auto=validate` passes
- [x] Application starts successfully

---

# Acceptance Criteria

The issue is complete when:

- [x] ProductBatch maps correctly to existing `product_batches`
- [x] Every ProductBatch belongs to exactly one Product
- [x] `createdBy` is derived from the authenticated user
- [x] ProductBatchRepository is implemented
- [x] ProductBatchService is implemented
- [x] ProductBatchController is implemented
- [x] `POST /api/v1/product-batches` works
- [x] `GET /api/v1/product-batches` works
- [x] `GET /api/v1/product-batches/{id}` works
- [x] ADMIN can create/read batches
- [x] STAFF can create/read batches
- [x] Batch code is unique and stable
- [x] Product must exist
- [x] Product must be ACTIVE for new batch creation
- [x] `quantity > 0`
- [x] `expiresAt > manufacturedAt`
- [x] Already-expired batches cannot be created through normal flow
- [x] Batch quantity is not treated as current inventory
- [x] Batch quantity is not decremented when stock changes
- [x] No InventoryItems are automatically created
- [x] No Machine/Slot information is stored on ProductBatch
- [x] No general update endpoint exists
- [x] No hard-delete endpoint exists
- [x] Pagination works
- [x] Product filtering works
- [x] Common exception handling is reused
- [x] Existing RBAC/security infrastructure is reused
- [x] Tests pass
- [x] Application starts
- [x] Flyway validation passes
- [x] Hibernate schema validation passes
- [x] Existing migrations remain unchanged

---
