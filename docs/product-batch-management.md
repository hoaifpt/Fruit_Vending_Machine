# Product Batch Management — Issue #21

Management traceability APIs use existing ProductBatch/Product/User mappings and
PostgreSQL product_batches. No Flyway migration or dependency change.

| Method | Path | Roles | Result |
| --- | --- | --- | --- |
| POST | /api/v1/product-batches | ADMIN, STAFF | 201, immutable batch |
| GET | /api/v1/product-batches | ADMIN, STAFF | 200, database page |
| GET | /api/v1/product-batches/{id} | ADMIN, STAFF | 200, batch details |

Both roles are independent and require an ACTIVE account. Existing bearer JWT,
current database authorities and common ApiResponse/ApiErrorResponse are reused.
Success responses include Cache-Control: no-store; creation includes relative Location.

## Creation

```json
{
  "batchCode": "MANGO-20261010-01",
  "productId": "c6a33ea7-0c1c-4bbf-a890-3b7286d10a02",
  "manufacturedAt": "2026-10-10T08:00:00+07:00",
  "expiresAt": "2026-10-12T08:00:00+07:00",
  "quantity": 20
}
```

Use an existing ACTIVE product and future expiration when trying this example.
Client supplies code: strip/uppercase Locale.ROOT, nonblank, at most 64 characters,
globally unique and immutable. Friendly duplicate check plus database UNIQUE guard.
No code generator or format beyond schema constraints is imposed.

Product lookup locks the existing row, serializing with catalog configuration/status
writes. Missing product 404; INACTIVE product 409. No Product or User is created or
changed. createdBy is always the authenticated principal's UUID, resolved using the
existing SecurityContext/AuthenticatedUser and UserRepository. Client-supplied creator,
identity, timestamps of creation, inventory, stock and machine/slot fields are rejected.

manufacturedAt/expiresAt require ISO-8601 JSON strings with Z or explicit offset.
They normalize to Instant UTC and truncate to database microseconds before validation.
expiresAt must be strictly after manufacturedAt and injected Clock's current instant.
Equality or already-expired records return 400. No historical import or expiration job.
Dates represent absolute instants; the original offset is not retained by TIMESTAMPTZ.

quantity is a positive 32-bit JSON integer token (1..2147483647). Decimal tokens,
numeric strings, booleans and overflow are rejected. It records original declared units,
not remaining/available stock. Creation never generates InventoryItems, assigns slots,
or changes quantities when an item later changes state.

## Reads and immutability

List uses PostgreSQL pagination, page 0, size 20, maximum 100. Optional productId exact
UUID filter; nonexistent product matches an empty page. Default sort createdAt,desc.
Approved fields: id, batchCode, manufacturedAt, expiresAt, quantity, createdAt; optional
asc/desc (asc when omitted). UUID ascending tie-break except sorting id itself.
To-one product entity graph fetches SKU/name without collection pagination or N+1.
Out-of-range pages are empty; negative page/invalid size/sort/UUID return 400.

DTO fields: id, batchCode, productId, productSku, productName, manufacturedAt, expiresAt,
quantity, createdBy, createdAt. Product SKU/name reflect current catalog values; the
batch has no duplicated catalog columns. Legacy null creator remains supported by
the existing schema; new API-created batches always record the caller. No user entity,
credential/token/role information or recursive inventory/product collections returned.

Expired batches and batches of subsequently INACTIVE products remain readable.
Missing detail returns 404. No PUT/PATCH/DELETE endpoints; role-authorized attempts
return 405. Ordinary API requests cannot rewrite or delete traceability records.
No stock calculation, optional expiration-state filter, alerts, inventory workflows,
order/payment/dispense/hardware/MQTT implementation in this issue.

## Swagger and contract

Contract: api-contract/api.yaml; Product Batches tag, two paths/three operations.
Generated Swagger/OpenAPI matches the versioned contract through documentation tests.
Production docs disabled according to existing configuration.

Local setup: existing .env/PostgreSQL, valid JWT_SECRET, API_DOCS_ENABLED=true.
From repository-root backend/:

```powershell
mvn spring-boot:run '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC'
```

Swagger: http://localhost:8080/swagger-ui/index.html
OpenAPI: http://localhost:8080/v3/api-docs
Login through /api/v1/auth/login, paste access token only into Authorize.
Try GET product-batches first; use disposable products/batches for writes.
Automated API tests and HTTP asset checks do not prove browser Try it out works;
actual verification and any browser tooling limitation are recorded in CURRENT_TASK.md.

## Verification

Run mvn clean verify from the Spring module. PostgreSQL18 Testcontainers apply/validate
Flyway V1-V8 and Hibernate ddl-auto=validate. Batch integration tests cover both roles,
creator provenance, strict requests, dates/quantity/code, DB uniqueness race, product
filter/paging/sorts, immutable history and existing JWT/current-role enforcement.
Documentation tests compare complete operation and schema semantics including examples,
parameters, errors, headers and security with api-contract/api.yaml and validate refs.
