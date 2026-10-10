# Machine Management API — Issue #17

Machine identity, configuration and administrative status only. Reuses the existing
Machine/MachineStatus mappings and Flyway V2 machines table. No schema or dependency change.

| Method | Path | Access |
| --- | --- | --- |
| GET | /api/v1/machines | ADMIN, STAFF |
| GET | /api/v1/machines/{id} | ADMIN, STAFF |
| POST | /api/v1/machines | ADMIN |
| PUT | /api/v1/machines/{id} | ADMIN |
| PATCH | /api/v1/machines/{id}/status | ADMIN |

Each request requires a Bearer JWT for an ACTIVE account. Current database roles are
reloaded on each request; roles are independent. HTTP guards reject STAFF writes before
body parsing; service/controller method guards reuse existing RBAC. Missing/invalid/expired
tokens or unavailable accounts return 401, insufficient roles 403. No public kiosk API.

## Configuration and lifecycle

POST accepts code, name, location, minTemperature, maxTemperature, minHumidity, maxHumidity.
Code is stripped and uppercased with Locale.ROOT before validation, nonblank, maximum 64
characters, unique and immutable. Duplicate code returns safe 409, including a database
UNIQUE conflict between concurrent requests. Existing legacy codes are not rewritten.
Name/location are stripped and required, maximum 200/500 characters.

Thresholds use BigDecimal: Celsius -100..100, humidity 0..100 percent, at most two
fractional digits. Excess precision returns 400 rather than rounding. Each minimum
must be strictly below its maximum; this API rule is stricter than the DB's <= CHECK.
API minTemperature/maxTemperature/minHumidity/maxHumidity map explicitly to existing
temperatureMin/temperatureMax/humidityMin/humidityMax entity properties.

Registration explicitly creates INACTIVE with null lastSeenAt. Existing entity/DB ACTIVE
defaults remain unchanged for other persistence use cases. PUT replaces required name,
location and all four thresholds. Code, status, id, lastSeenAt, timestamps and unknown
fields are rejected. PATCH accepts only nonnull ACTIVE, INACTIVE or MAINTENANCE; repeated
same-status requests are idempotent. These statuses configure availability, not connectivity.
Both writes lock the machine row inside the service transaction to preserve concurrent
configuration/status changes. No optimistic-lock column or history cascade is added.

No DELETE endpoint: an authenticated ADMIN receives 405. Set INACTIVE to deactivate.
Related slots, inventory, readings, alerts, orders, payments and events remain untouched.
Their future workflows must check machine availability themselves. This issue does not
implement slots, inventory, telemetry, heartbeat, online/offline, payments or dispensing.

Response fields are the twelve machine fields, with UTC Instant/ISO-8601 timestamps.
lastSeenAt is system-managed and may be null; legacy location may also be null.
Missing UUID returns 404, malformed UUID 400. Common ApiResponse/ApiErrorResponse and
global exception handling are reused; no SQL/Hibernate internals are exposed.
Success responses use Cache-Control: no-store; 201 includes relative Location.

## Listing

GET /api/v1/machines?page=0&size=20&status=ACTIVE&search=campus&sort=name,asc

Database paging defaults page 0, size 20; page must be nonnegative, size 1..100.
Response data contains content, page, size, totalElements, totalPages.
Out-of-range pages are empty with matching totals preserved. All statuses are visible
by default. Optional status and search combine; search is stripped, case-insensitive,
literal substring on code/name/location, maximum 200 characters. Blank search disables
the filter; percent and underscore are literal characters.

One sort field/direction uses Spring conventions. Approved fields: id, code, name,
location, status, createdAt, updatedAt. Direction asc/desc is case-insensitive; omitted
direction means asc, omitted/empty sort uses createdAt,desc. UUID ascending breaks ties
unless sorting by id. Invalid sort/parameters return 400.

## Swagger and frontend contract

Normal development URLs with SERVER_PORT=8080 and API_DOCS_ENABLED=true:

- Swagger UI: http://localhost:8080/swagger-ui/index.html
- OpenAPI JSON: http://localhost:8080/v3/api-docs
- OpenAPI YAML: http://localhost:8080/v3/api-docs.yaml
- Versioned contract: repository-root api-contract/api.yaml, tag Machines.

From the backend module:

```powershell
mvn spring-boot:run '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC'
```

Use the existing root .env import/environment, running PostgreSQL and valid JWT_SECRET.
Bootstrap creates the initial ADMIN only when none exists. Login through Auth, then
Authorize with the token alone, without the Bearer prefix. Try GET /machines; use only
disposable development data for writes. Production documentation remains disabled.

## Verification

MachineManagementIntegrationTest covers real login/JWT, access matrix/current-role
revocation, normalization/immutability, nullable legacy fields, strict request validation,
threshold bounds/precision, DB UNIQUE race, database paging/filter/search/sort, status
lifecycle, service guards, concurrent writes and preservation of related history fixtures.
Fixtures for future domains are test-only SQL, not additional implemented workflows.
MachineManagementDocumentationTest loads Swagger UI/config/OpenAPI and compares complete
Machine operations, parameters, headers, examples, security and schemas with api-contract.
It resolves contract references and independently checks required fields/decimal bounds.

Run mvn clean verify with Java 21 and Docker. Integration tests use isolated PostgreSQL 18
Testcontainers, all eight migrations and Hibernate ddl-auto=validate, without importing .env.
Actual test/UI evidence and Git delivery status live in backend/.ai/CURRENT_TASK.md and HANDOFF.md.
