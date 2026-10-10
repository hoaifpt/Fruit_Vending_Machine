# Issue #17 — Machine Management API

Title: [BE] Implement Machine Management API
Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/17
Branch: feature/17-machine-management-api
Branch base: 4c6212d056abd38bd71e63da1bae04a6b0f6b55a.
Source reread via GitHub REST on 2026-10-10; original checklist below retained in full.

## Current status — implementation and source checklist verified locally

User resumed implementation in this chat. Completed the five Machine master-data APIs,
reviewed/corrected inherited drafts and Swagger wording, added PostgreSQL integration
and full contract consistency tests. All original issue checklist items pass.
User confirmed everything works and explicitly authorized commit/push on 2026-10-10.
PR/merge/GitHub issue edits are not authorized or performed for #17.
User handles merges manually. Source checklist completion is not Git delivery.

## Scope / intended decisions

Five API operations: GET list, GET detail, POST register, PUT configuration,
PATCH status. ADMIN reads/writes, STAFF reads only; reuse current JWT/RBAC/error wrappers.
Reuse existing Machine/MachineStatus mappings, not the conceptual issue entity example.
API field names minTemperature/maxTemperature/minHumidity/maxHumidity map explicitly
to existing temperatureMin/temperatureMax/humidityMin/humidityMax entity properties.
UUID identity; Instant UTC timestamps follow project convention.
Code stripped and uppercased using Locale.ROOT before validation, unique and immutable.
New registrations explicitly set INACTIVE in service, lastSeenAt null/system-managed.
Existing entity and database ACTIVE defaults are unchanged; API sets its own lifecycle.
Required nonblank name/location; limits code 64, name 200, location 500. Database location
is nullable: legacy response null is allowed; new/update requests require location.
BigDecimal thresholds: temperature -100..100, humidity 0..100, at most two decimal
places, reject rather than round; API requires strict min < max even though DB CHECK
permits equality. Cross-field rule belongs in service.
List: page 0, size 20, max 100; optional status and literal case-insensitive substring
search on code/name/location; approved sort fields id/code/name/location/status/
createdAt/updatedAt with UUID ascending tie-break. Maximum search length 200.
Strict separate DTOs reject unknown/immutable/status/lastSeenAt fields.
Profile/status writes lock the machine row to avoid lost cross-field updates.
Administrative status ACTIVE/INACTIVE/MAINTENANCE is not online/offline connectivity.
No hard DELETE; deactivate without modifying related history.

## Database impact / non-goals

No schema/dependency change. Applied Flyway V1–V8, Machine entity/enum and pom.xml
unchanged. Hibernate remains ddl-auto=validate. Backend and root docs/contract only.
No slots, inventory, batches, sensors, MQTT, ESP32/heartbeat, online/offline, automatic
status, refrigeration/motor/GPIO, orders/payments, dispense, alerts/events or dashboard.
No .env/real credentials read or edited; no developer database writes.

## Verification — 2026-10-10 (Asia/Saigon)

- Java 21.0.10, Maven 3.9.12; mvn clean verify: BUILD SUCCESS.
  297 tests, 0 failures, 0 errors, 0 skipped. Machine: 59 integration + 1 documentation.
  Existing Auth/User/Product/RBAC/bootstrap/entity regression tests all passed.
- All eight Flyway migrations applied and validated in isolated PostgreSQL 18 containers;
  Hibernate ddl-auto=validate initialized successfully. EntityMappingTest also passed.
  Applied migrations, Machine entity/enum and pom.xml remain unchanged.
- Source checklist evidence: MachineManagementIntegrationTest covers creation/defaults/
  normalized uniqueness + DB race, strict input/ranges/decimal precision, DB page/status/
  literal search/sort, reads/null fields, configuration immutability, status lifecycle,
  real JWT access/current DB roles, service guards, concurrent writes and related-history
  snapshots. MachineManagementDocumentationTest compares full operation/schema/parameter/
  response/header/example/security semantics and validates contract references.
- Contract changed: repository-root api-contract/api.yaml only; adds Machines tag,
  three paths/five operations and seven request/response/wrapper schemas, existing
  Auth/User/Product contract preserved. Their documentation tests also passed.
- Packaged JAR started independently on disposable PostgreSQL 18, no .env import:
  Swagger UI HTML, CSS, bundle JS, standalone JS, initializer JS, swagger-config and
  OpenAPI returned 200. All five documented Machine operation IDs appeared.
  Real login 200; POST 201 with normalized code/INACTIVE/null lastSeenAt; filtered
  list/detail/PUT/PATCH 200; anonymous list 401.
- Actual temporary QA URLs verified:
  http://127.0.0.1:53981/swagger-ui/index.html
  http://127.0.0.1:53981/v3/api-docs
  QA process/container were removed after checks; these temporary URLs are no longer live.
- User manually rechecked the implementation and confirmed everything works on 2026-10-10.
  Specific browser/Swagger interactions were not enumerated in that confirmation.
- Browser rendering/Swagger Try it out not verified by the agent: both node_repl and cua_repl exited
  during initialization with sandbox/helper setup failures. HTTP/MockMvc documentation
  smoke checks and live authenticated REST checks passed; they do not prove browser
  interaction. Next manual UI check: local dev Swagger, Authorize, GET /machines.
  This is a disclosed tooling limitation; no original source checklist item is omitted.
- Normal development setup: existing root .env/PostgreSQL, API_DOCS_ENABLED=true and valid
  JWT_SECRET; from backend module run:
  mvn spring-boot:run '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC'
  SERVER_PORT=8080 URLs:
  http://localhost:8080/swagger-ui/index.html and http://localhost:8080/v3/api-docs
  Production documentation remains disabled.
- Logs/artifacts (ignored): backend/target/issue17-verify.log, issue17-qa.stdout.log,
  issue17-qa.stderr.log, machine-management-openapi.json and surefire-reports/.
- git diff --check passed; no unrelated changes or developer DB writes.
  Default exec/apply_patch sandbox failures persisted; approved escalated exec and the
  current apply_patch executable were used. No global Git configuration changed.

## Git delivery

Implementation locally verified; no original checklist items remain incomplete.
Delivery includes implementation, tests, contract, docs and guidance only.
User authorized commit/push after manual verification. Delivery commit subject:
feat: implement machine management API (#17)
Remote branch: origin/feature/17-machine-management-api.
Use Git history/upstream status for the immutable delivery commit and push confirmation.
No PR/merge/issue closure/checklist edit authorization is implied.

## Source checklist — complete, evidence above

# Testing

## 35. Create Machine Tests

Verify:

- [x] ADMIN can create machine
- [x] New machine defaults to `INACTIVE`
- [x] Machine code is stored correctly
- [x] Machine code normalization works if adopted
- [x] Duplicate code returns `409`
- [x] Blank code returns `400`
- [x] Blank name returns `400`
- [x] Invalid temperature range returns `400`
- [x] Invalid humidity range returns `400`
- [x] STAFF cannot create machine
- [x] Unauthenticated request receives `401`

---

# 36. List Machine Tests

Verify:

- [x] ADMIN can list machines
- [x] STAFF can list machines
- [x] Pagination works
- [x] Status filtering works
- [x] Search works if implemented
- [x] Unauthenticated request receives `401`

---

# 37. Get Machine Tests

Verify:

- [x] ADMIN can retrieve machine
- [x] STAFF can retrieve machine
- [x] Missing machine returns `404`
- [x] `lastSeenAt` can safely be null
- [x] Unauthenticated request receives `401`

---

# 38. Update Machine Tests

Verify:

- [x] ADMIN can update name
- [x] ADMIN can update location
- [x] ADMIN can update environmental thresholds
- [x] Machine code remains unchanged
- [x] Status cannot be modified through general update
- [x] `lastSeenAt` cannot be modified
- [x] Invalid threshold configuration returns `400`
- [x] Missing machine returns `404`
- [x] STAFF receives `403`

---

# 39. Status Tests

Verify:

- [x] ADMIN can change INACTIVE → ACTIVE
- [x] ADMIN can change ACTIVE → MAINTENANCE
- [x] ADMIN can change MAINTENANCE → ACTIVE
- [x] ADMIN can change ACTIVE → INACTIVE
- [x] STAFF cannot change status
- [x] Invalid status returns `400`
- [x] Missing machine returns `404`

---

# 40. Security Integration Tests

Verify:

```text
ADMIN
  ↓
POST /api/v1/machines
  ↓
Allowed
```

```text
STAFF
  ↓
POST /api/v1/machines
  ↓
403
```

```text
STAFF
  ↓
GET /api/v1/machines
  ↓
Allowed
```

```text
No JWT
  ↓
GET /api/v1/machines
  ↓
401
```

---

# 41. Persistence / Regression Tests

Verify:

- [x] Machine persists correctly
- [x] MachineStatus persists as expected
- [x] Threshold decimal precision is preserved
- [x] Unique machine code constraint works
- [x] Existing Product/User/Auth tests continue to pass
- [x] Flyway validation passes
- [x] Hibernate schema validation passes
- [x] Application starts successfully

---

# Acceptance Criteria

The issue is complete when:

- [x] Machine entity maps correctly to the existing `machines` table
- [x] MachineRepository is implemented
- [x] MachineService is implemented
- [x] MachineController is implemented
- [x] `GET /api/v1/machines` works
- [x] `GET /api/v1/machines/{id}` works
- [x] `POST /api/v1/machines` works
- [x] `PUT /api/v1/machines/{id}` works
- [x] `PATCH /api/v1/machines/{id}/status` works
- [x] Machine list supports pagination
- [x] Status filtering works
- [x] Machine code is unique
- [x] Machine code is immutable after creation
- [x] New machines default to `INACTIVE`
- [x] Environmental threshold validation works
- [x] `lastSeenAt` is read-only
- [x] ADMIN can read/write
- [x] STAFF can read
- [x] STAFF cannot write
- [x] Unauthenticated requests receive `401`
- [x] Unauthorized writes receive `403`
- [x] Missing machine returns `404`
- [x] Duplicate machine code returns `409`
- [x] Machines are deactivated instead of hard-deleted
- [x] No slot logic is implemented
- [x] No inventory logic is implemented
- [x] No MQTT/IoT logic is implemented
- [x] Existing RBAC is reused
- [x] Existing common error handling is reused
- [x] Tests pass
- [x] Application starts successfully
- [x] Flyway validation passes
- [x] Hibernate `ddl-auto=validate` passes
- [x] Existing applied migrations remain unchanged

---
