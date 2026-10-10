# Issue #18 — Machine Slot Management

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/18
Title: [BE] Implement Machine Slot Management
Branch: feature/18-machine-slot-management
Base: d60a43c801d89b23a051938879d5a72362f2a316 (origin/dev fetched 2026-10-10).
User merged #17 in PR #19; e78fb6d is in dev ancestry. Working tree was clean.
Implementation and #18 commit/push explicitly authorized by the user.
No PR/merge/issue edits authorized; user handles merges manually.

## Scope and decisions

Five nested slot APIs: list/detail/create/update capacity/update status.
ADMIN reads/writes, STAFF reads; existing JWT/RBAC and common errors reused.
Existing MachineSlot/SlotStatus entities and Flyway V2 reused unchanged.
Slot code stripped/uppercase Locale.ROOT, nonblank, maximum 32 characters,
unique per machine, immutable; no imposed hardware naming/slot-count policy.
New slot ACTIVE even when parent INACTIVE/MAINTENANCE. Missing parent 404.
Get/update/status lookups scope slotId to machineId; cross-machine access 404.
Capacity required positive 32-bit JSON integer token; strings/decimal coercion rejected.
Status requires an exact string, no enum ordinals. No hardware limits or inventory checks.
Strict separate DTOs reject unknown/read-only/unrelated fields.
List DB pagination page 0, size 20/max100; optional SlotStatus filter; approved sort
id/slotCode/capacity/status/createdAt/updatedAt, default slotCode,asc; UUID tie-break.
Capacity/status writes lock slot rows to preserve concurrent changes and history.
Responses: id/machineId/slotCode/capacity/status/createdAt/updatedAt only, Instant UTC.
No DELETE; INACTIVE preserves history. Slot ERROR does not change parent status.

## Database impact / non-goals

No schema/dependency/migration/entity/enum change. Hibernate ddl-auto=validate remains.
No Product/Batch/Inventory workflows, quantities, allocation/expiration, hardware,
MQTT/sensors/heartbeat, motor/servo/GPIO, payment/orders/dispense or automatic ERROR.
Backend implementation and root docs/api-contract only. No .env/developer DB changes.

## Verification and completion — 2026-10-10 (Asia/Saigon)

Implementation complete against all original source checklist items below.
User requested #18 commit/push on 2026-10-10 after disclosure of the browser testing
limitation. Delivery commit: feat: implement machine slot management (#18), on
feature/18-machine-slot-management. Verify final hash/publication with Git refs.
No PR/merge/GitHub issue edits authorized or performed.

- Java 21.0.10, Maven 3.9.12; mvn clean verify BUILD SUCCESS:
  351 tests, 0 failures/errors/skipped. Slot: 53 integration + 1 documentation.
  Existing Machine/Product/User/Auth/RBAC/bootstrap/entity tests all passed.
- Isolated PostgreSQL 18 containers applied and validated Flyway V1-V8; Hibernate
  ddl-auto=validate initialized successfully. EntityMappingTest passed.
  Migrations, entities/enums and pom.xml unchanged; no developer DB/.env changes.
- MachineSlotManagementIntegrationTest covers all original business/API/security
  checklist groups plus strict JSON integer capacity and string status, schema bounds,
  normalized per-machine uniqueness + DB race, provisioning under all parent statuses,
  positive capacities without hardware limits, machine-scoped page/filter/sort,
  missing/cross-machine IDs, safe DTO shape, service guards, current JWT roles,
  concurrent capacity/status writes and related inventory/dispense fixture snapshots.
- MachineSlotManagementDocumentationTest compares complete operations/parameters/
  schemas/validation/responses/headers/examples/security with api-contract/api.yaml,
  resolves references and independently validates DTO shape and limits.
  Contract changes are additive: Machine Slots tag, three paths/five operations,
  seven schemas. Existing Auth/User/Product/Machine docs consistency tests all pass.
- Packaged JAR started on disposable PostgreSQL 18 and random localhost port with
  environment import disabled. Swagger HTML/CSS/JS/config/OpenAPI 200; all five
  slot operation IDs present. Real login 200, slot POST 201 (normalized code/ACTIVE/
  correct parent UUID), list/detail/PUT/PATCH 200; cross-machine 404, duplicate 409,
  fractional capacity/ordinal status 400; STAFF reads 200/writes 403; anonymous 401;
  DELETE 405. Slot ERROR left parent INACTIVE.
- Actual QA URLs verified:
  http://127.0.0.1:55978/swagger-ui/index.html
  http://127.0.0.1:55978/v3/api-docs
  QA JAR PID 25736 and container fvm-issue18-qa cleaned up; URLs no longer live.
- Browser rendering/Swagger Try it out not verified: cua_repl initialization failed
  twice with trusted Node kernel exit. Earlier node_repl attempts had sandbox/helper startup failures.
  HTTP/MockMvc/static-asset checks and live REST calls do not prove UI interaction.
  Next manual UI step: local Swagger, Authorize, Try GET slots for a disposable machine.
  No original source checklist item omitted; this tooling limitation is disclosed.
- Normal local setup: existing .env/PostgreSQL, API_DOCS_ENABLED=true and JWT_SECRET;
  from backend module:
  mvn spring-boot:run '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC'
  Port 8080 URLs: http://localhost:8080/swagger-ui/index.html and
  http://localhost:8080/v3/api-docs. Production docs remain disabled.
- Ignored evidence: backend/target/issue18-verify.log, issue18-qa.stdout.log,
  issue18-qa.stderr.log, machine-slot-management-openapi.json and surefire-reports/.
- git diff --check passed; only current issue files changed. Current explicit user
  request authorizes commit/push for #18; verify clean tree and matching remote HEAD
  after delivery. Browser rendering/Try it out remains unverified.

## Source checklist — complete, evidence above

# Testing

## Create Slot

Verify:

- [x] ADMIN can create slot
- [x] Parent Machine must exist
- [x] New slot receives expected initial status
- [x] Capacity must be > 0
- [x] Duplicate slot code in same Machine returns `409`
- [x] Same slot code in different Machines is allowed
- [x] STAFF cannot create slot
- [x] Unauthenticated request receives `401`

---

## List Slots

Verify:

- [x] ADMIN can list slots
- [x] STAFF can list slots
- [x] Only slots belonging to requested Machine are returned
- [x] Missing Machine returns `404`
- [x] Status filtering works if implemented
- [x] Pagination works if implemented

---

## Get Slot

Verify:

- [x] ADMIN can retrieve slot
- [x] STAFF can retrieve slot
- [x] Missing slot returns `404`
- [x] Slot belonging to another Machine returns `404`
- [x] Machine relationship does not cause recursive serialization

---

## Update Slot

Verify:

- [x] ADMIN can update capacity
- [x] Capacity must remain > 0
- [x] slotCode remains unchanged
- [x] machineId remains unchanged
- [x] status cannot be changed through general update
- [x] STAFF receives `403`
- [x] Missing slot returns `404`

---

## Status

Verify:

- [x] ADMIN can set ACTIVE
- [x] ADMIN can set INACTIVE
- [x] ADMIN can set ERROR
- [x] STAFF cannot change slot status
- [x] Invalid status returns `400`
- [x] Changing slot status does not automatically modify Machine status

---

## Security Integration

Verify:

```text
ADMIN
  ↓
POST /machines/{id}/slots
  ↓
Allowed
```

```text
STAFF
  ↓
POST /machines/{id}/slots
  ↓
403
```

```text
STAFF
  ↓
GET /machines/{id}/slots
  ↓
Allowed
```

```text
No JWT
  ↓
GET /machines/{id}/slots
  ↓
401
```

---

## Regression

Verify:

- [x] Existing Machine Management tests pass
- [x] Existing Product tests pass
- [x] Existing User/Auth tests pass
- [x] Flyway validation passes
- [x] Hibernate `ddl-auto=validate` passes
- [x] Application starts successfully

---

# Acceptance Criteria

The issue is complete when:

- [x] MachineSlot maps correctly to `machine_slots`
- [x] MachineSlot belongs to exactly one Machine
- [x] MachineSlotRepository is implemented
- [x] MachineSlotService is implemented
- [x] MachineSlotController is implemented
- [x] `GET /api/v1/machines/{machineId}/slots` works
- [x] `GET /api/v1/machines/{machineId}/slots/{slotId}` works
- [x] `POST /api/v1/machines/{machineId}/slots` works
- [x] `PUT /api/v1/machines/{machineId}/slots/{slotId}` works
- [x] `PATCH /api/v1/machines/{machineId}/slots/{slotId}/status` works
- [x] Slot code is unique within a Machine
- [x] Same slot code may exist in different Machines
- [x] Slot code is immutable
- [x] Capacity must be greater than zero
- [x] Capacity is not treated as current stock
- [x] ADMIN can read/write
- [x] STAFF can read
- [x] STAFF cannot write
- [x] Unauthenticated requests receive `401`
- [x] Invalid parent Machine returns `404`
- [x] Cross-machine slot access returns `404`
- [x] Duplicate slot returns `409`
- [x] Slots are disabled rather than hard-deleted
- [x] No Product/Batch/Inventory responsibilities are added to MachineSlot
- [x] No hardware/MQTT/dispense logic is implemented
- [x] Existing RBAC is reused
- [x] Existing common error handling is reused
- [x] Tests pass
- [x] Application starts successfully
- [x] Flyway validation passes
- [x] Hibernate validation passes
- [x] Existing migrations remain unchanged

---
