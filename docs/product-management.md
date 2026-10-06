# Product Management API — Issue #14

## Scope and access

Catalog/master data only. Product is not a bowl, production batch, stock count or slot.
The existing Product/ProductStatus mappings and Flyway V3 products table are reused.
No schema or dependency change. No image upload/storage, URL fetching or DELETE endpoint.

| Method | Path | Access |
| --- | --- | --- |
| GET | /api/v1/products | ADMIN, STAFF |
| GET | /api/v1/products/{id} | ADMIN, STAFF |
| POST | /api/v1/products | ADMIN |
| PUT | /api/v1/products/{id} | ADMIN |
| PATCH | /api/v1/products/{id}/status | ADMIN |

All requests require a Bearer JWT for an ACTIVE account. Both roles are independent.
HTTP guards run before request parsing; service/controller method guards reuse existing RBAC.
Anonymous/invalid/expired JWT -> 401; insufficient role -> 403. Accounts/roles are reloaded
from DB for each JWT request. No public catalog/kiosk endpoint is introduced.

## Input and business policies

Create accepts sku, name, description, price, imageUrl only.
SKU is stripped and uppercased with Locale.ROOT before validation, 1–64 characters,
nonblank and unique; stored SKU is immutable. New products are ACTIVE server-side.
Duplicate precheck -> 409; DB UNIQUE is the final concurrent-create guard (safe 409).
Existing nonnormalized legacy rows are not rewritten by this issue.

Name: stripped, nonblank, 1–200 characters. Description: nullable TEXT.
Image URL: nullable string reference, maximum 2048 characters, never fetched by backend.
Price: BigDecimal, strictly positive, maximum 9999999999.99, at most two fractional digits.
Over-precision is rejected with 400 rather than rounded or converted through floating point.
Flyway's existing CHECK permits zero, but the API/service intentionally require > 0.
Only the current catalog price changes; order-item and payment snapshots remain untouched.

PUT replaces name/description/price/imageUrl. Omitted/null optional fields clear them.
SKU, status, IDs, timestamps and unrelated-domain fields are rejected with 400.
PATCH accepts only a nonnull status: ACTIVE or INACTIVE; same-status requests are idempotent.
INACTIVE disables future active-only operational use; it does not delete history or change
existing batches, inventory, orders or payments. Those future workflows must check ACTIVE.
Both profile and status updates lock the product row within their transactions, preventing
stale writes from overwriting each other's fields. No generic optimistic-lock column added.
Responses contain only the nine catalog fields, timestamps as UTC Instant/ISO-8601.
Missing UUID -> 404; malformed UUID -> 400. Unsupported authenticated ADMIN DELETE -> 405.

## Pagination, filters and sorting

GET /api/v1/products?page=0&size=20&status=ACTIVE&search=mango&sort=name,asc

DB pagination defaults page 0, size 20; size 1–100 and nonnegative page required.
Response data: content, page, size, totalElements, totalPages.
Out-of-range pages are empty while retaining matching totals.
Both statuses are visible without a status filter.
Search is optional, stripped, case-insensitive literal substring on name OR SKU,
maximum 200 characters; blank means no filter. Percent/underscore are literal, not wildcards.
Status and search combine with pagination and sorting; no full-table in-memory paging.
One sort value follows Spring's field,direction convention; allowed fields:
id, sku, name, price, status, createdAt, updatedAt. Direction asc/desc is case-insensitive;
omitted direction means asc, omitted/empty sort uses createdAt,desc.
UUID ascending is added as a deterministic tie-break except when sorting by id.
Invalid/unapproved sort -> safe 400, not leaked entity/query internals.

## Responses, Swagger and frontend contract

Common ApiResponse/ApiErrorResponse wrappers and centralized exception handling reused.
Success 200 (reads/updates) or 201 (create); successes have Cache-Control: no-store.
Create has relative Location /api/v1/products/{id}. 401 has WWW-Authenticate: Bearer.
Common 400/401/403/404/409/500 schemas/statuses are documented per applicable operation.
Examples use synthetic products only, never credentials or real tokens.

With SERVER_PORT=8080, API_DOCS_ENABLED=true and existing root .env configuration:

- Swagger UI: http://localhost:8080/swagger-ui/index.html
- OpenAPI JSON: http://localhost:8080/v3/api-docs
- OpenAPI YAML: http://localhost:8080/v3/api-docs.yaml
- Frontend contract: repository-root api-contract/api.yaml, tag Products.

From the backend module run:
mvn spring-boot:run '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC'

Use the existing launcher/environment configuration, running PostgreSQL and valid JWT_SECRET.
No new configuration is required. Use Initial Admin Bootstrap only for a DB without ADMIN.
Login with an isolated development account, then Authorize with the token alone, without
typing the Bearer prefix. Try GET /products; use disposable product fixtures for write tests.
Production documentation remains disabled. Never test writes against production data.

## Verification

ProductManagementIntegrationTest covers real login/JWT, access matrix and role revocation,
validation/schema limits, exact decimal persistence, normalization/immutability, DB UNIQUE
race, combined search/filter/page/sort, read details, status roundtrip, service guards,
concurrent profile/status writes and preservation of batch/inventory/order/payment fixtures.
Those historical fixtures are test-only SQL, not newly implemented future workflows.
ProductManagementDocumentationTest loads Swagger UI/config/OpenAPI, compares complete
Product operations (parameters, requests, responses, headers, examples, security) and semantic
schemas with api-contract/api.yaml, validates refs and independently checks key DTO constraints.
Existing Auth/RBAC docs tests include Product paths and continue excluding test-only routes.
All tests use PostgreSQL 18 Testcontainers with environment import disabled; no developer DB.

Run mvn clean verify using Java 21 and Docker when the target JAR is not held open.
See backend/.ai/CURRENT_TASK.md and HANDOFF.md for actual verification and delivery status.
