# Issue #14 — Product Management API

Title: [BE] Implement Product Management API
Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/14
Branch: feature/14-product-management-api
Base: origin/dev a029904 (issue #12 merged by user through PR #15).

## Scope and decisions

Five /api/v1/products operations. ADMIN reads/writes; STAFF reads only.
Reuse Product/ProductStatus and existing security/common exceptions. Strict separate DTOs;
SKU strip/uppercase (Locale.ROOT), immutable on update. Price BigDecimal, positive,
maximum 9999999999.99 and two decimal places; reject excess precision rather than round.
DB pagination defaults page 0/size 20, maximum 100, status + literal case-insensitive
substring search on name/SKU; approved Spring Sort fields, deterministic UUID tie-break.
Profile/status writes row-lock product to prevent stale cross-field overwrites.
Image URL is a nullable reference only, no upload/storage or server-side URL fetching.
UTC Instant timestamps follow repository convention (issue's OffsetDateTime example
is conceptual). Existing NUMERIC check permits zero; service/API require strictly positive.

## Database impact and non-goals

No schema/dependency change; applied V1–V8 unchanged, Hibernate ddl-auto=validate.
No batch/inventory/quantity/expiration/machine/slot/order/payment/MQTT/dispensing/upload/
hard delete/dashboard. Backend and root docs/contract only. User confirmed manual retest
and authorized commit/push for #14. PR/merge/GitHub issue edits remain out of scope.

## Verification

Implementation complete locally on 2026-10-06; all 79 source checklist items verified.
Source section 39 (no checkboxes) verified by real ADMIN/STAFF login -> JWT -> products API.
No incomplete checklist item or implementation/verification blocker remains.

- Final full Maven test run: 237 tests, zero failures/errors/skips (all original 177 pass).
- Final clean verify: mvn -q -f target/issue14-verification-pom.xml clean verify, exit 0.
  Original target JAR is held by user's Java process (observed PID 26924), so verification
  uses an ignored temporary copy of the unchanged pom.xml with absolute original source/
  test/resource paths, module working directory and separate target/issue14-verification.
  Dependencies/plugins remain the same; repository pom.xml is unchanged. Normal mvn clean
  verify remains the usual workflow after the user stops their running JAR.
- Java 21.0.10, PostgreSQL 18.6 Testcontainers, Flyway V1–V8 validation and Hibernate
  ddl-auto=validate. EntityMappingTest covers all existing mappings and real servlet startup.
- ProductManagementIntegrationTest: 59 tests. Create/default/normalized SKU, BCrypt-backed
  real ADMIN/STAFF login + JWT authorization, all reads/writes/access errors and role
  revocation; strict DTOs/blank/schema limits/positive NUMERIC precision/boundaries;
  actual SQL OFFSET/FETCH FIRST verified; combined status/name+SKU literal search/paging/
  approved sorting/tie-break; detail/404/UUID400; immutable SKU/status/general fields;
  status roundtrip/idempotence, DELETE405; UNIQUE race returns 201/409 with rollback;
  row-lock concurrent catalog/status writes; service validation/authorization outside MVC;
  snapshot equality for related batch/inventory/order-item/order/payment fixture rows
  after price update/deactivation. No future business workflow is introduced by fixtures.
- ProductManagementDocumentationTest: 1 test. Swagger UI/config/OpenAPI smoke, complete
  product operations/parameters/request/responses/headers/examples/security vs versioned
  api-contract/api.yaml; semantic schemas/nullability/required/validation and local refs.
  Independent required-field/length/positive bound/multipleOf/enum/response-field assertions.
  JSON/YAML number nodes compare decimal meaning (35000 and 35000.0 are equivalent).
- Existing Auth/RBAC docs tests now include Product paths but still exclude test-only APIs;
  no security assertion weakened. Existing User/Auth/bootstrap/persistence tests pass.
- Actual verification JAR browser smoke at localhost:64749 with disposable PostgreSQL:
  synthetic ADMIN login 200; Swagger Products contains all five operations; Authorize +
  POST normalized QA product 201; GET page=0,size=20,search=mango,sort=name,asc 200,
  exact safe catalog/price/status/pagination and no-store, matching new product.
  Proof: backend/target/product-management-swagger.jpg (ignored screenshot, no credentials).
  QA token cleared, tab closed, exact QA Java process stopped and --rm DB auto-removed;
  user's original app PID 26924 remains running, developer DB/environment untouched.
- Verification JAR: backend/target/issue14-verification/backend-0.0.1-SNAPSHOT.jar;
  includes ProductController/ProductService but no test/Rbac fixtures.
- git diff --check passes; Flyway, Product entity/enum, pom.xml, .env/.env.example and
  apps/frontend/kiosk/firmware unchanged. No schema/dependency change or unrelated feature.

Swagger (normal SERVER_PORT=8080): http://localhost:8080/swagger-ui/index.html
OpenAPI JSON: http://localhost:8080/v3/api-docs
Use existing .env + PostgreSQL, API_DOCS_ENABLED=true and valid JWT_SECRET.
From backend module: mvn spring-boot:run '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC'.
See ../../docs/product-management.md; updated frontend contract: api-contract/api.yaml.
User's manual retest passed; commit/push for #14 is explicitly authorized.
Delivery is pending remote verification. User handles merge into dev manually.

## Source checklist under original headings

## 34. Create Product Tests

Verify:

- [x] ADMIN can create product
- [x] Product defaults to ACTIVE
- [x] SKU is stored correctly
- [x] SKU normalization works if adopted
- [x] Duplicate SKU returns `409`
- [x] Blank SKU returns `400`
- [x] Blank name returns `400`
- [x] Zero price returns `400`
- [x] Negative price returns `400`
- [x] STAFF cannot create product
- [x] Unauthenticated request receives `401`

---


# 35. List Product Tests

Verify:

- [x] ADMIN can list products
- [x] STAFF can list products
- [x] Pagination works
- [x] ACTIVE filter works
- [x] INACTIVE filter works
- [x] Search works if implemented
- [x] Sorting works if supported
- [x] Unauthenticated request receives `401`

---


# 36. Get Product Tests

Verify:

- [x] ADMIN can retrieve product
- [x] STAFF can retrieve product
- [x] Missing product returns `404`
- [x] Unauthenticated request receives `401`

---


# 37. Update Product Tests

Verify:

- [x] ADMIN can update name
- [x] ADMIN can update description
- [x] ADMIN can update price
- [x] ADMIN can update image URL
- [x] SKU remains unchanged
- [x] Status cannot be changed through general update
- [x] Invalid price returns `400`
- [x] Missing product returns `404`
- [x] STAFF receives `403`

---


# 38. Product Status Tests

Verify:

- [x] ADMIN can set ACTIVE → INACTIVE
- [x] ADMIN can set INACTIVE → ACTIVE
- [x] STAFF cannot change status
- [x] Invalid status returns `400`
- [x] Missing product returns `404`

---


## 39. Security Integration Tests (source has no checkboxes)

Verified: ADMIN login -> JWT -> POST products allowed; STAFF login -> JWT -> POST products
403; STAFF GET products allowed; no JWT GET products 401 through existing security.

# 40. Persistence / Regression Tests

Verify:

- [x] Product persists correctly
- [x] Product status persists correctly
- [x] BigDecimal price persists without floating-point conversion
- [x] Unique SKU constraint works
- [x] Existing User/Auth tests continue to pass
- [x] Flyway validation passes
- [x] Hibernate schema validation passes
- [x] Application starts successfully

---


# Acceptance Criteria

The issue is complete when:

- [x] Product entity maps correctly to the existing `products` table
- [x] ProductRepository is implemented
- [x] ProductService is implemented
- [x] ProductController is implemented
- [x] `GET /api/v1/products` works
- [x] `GET /api/v1/products/{id}` works
- [x] `POST /api/v1/products` works
- [x] `PUT /api/v1/products/{id}` works
- [x] `PATCH /api/v1/products/{id}/status` works
- [x] Product list supports pagination
- [x] Basic status filtering works
- [x] SKU is unique
- [x] SKU is treated as stable/immutable after creation
- [x] Price uses `BigDecimal`
- [x] Price must be greater than zero
- [x] New products default to ACTIVE
- [x] ADMIN can read and write products
- [x] STAFF can read products
- [x] STAFF cannot create/update/change product status
- [x] Unauthenticated requests receive `401`
- [x] Unauthorized write attempts receive `403`
- [x] Missing products return `404`
- [x] Duplicate SKU returns `409`
- [x] Products are deactivated instead of hard-deleted
- [x] JPA entities are not exposed directly
- [x] Product does not contain batch/inventory/slot responsibilities
- [x] Existing common error handling is reused
- [x] Existing authorization infrastructure is reused
- [x] Tests pass
- [x] Application starts successfully
- [x] Flyway validation passes
- [x] Hibernate `ddl-auto=validate` passes
- [x] Existing migrations remain unchanged
- [x] No unrelated feature is implemented

---
