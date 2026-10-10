# Machine Slot Management — Issue #18

Slots define physical positions in one machine, their maximum capacity and status.
Reuses MachineSlot/SlotStatus and the existing Flyway V2 machine_slots table.
No schema, entity, enum or dependency changes.

| Method | Path | Access |
| --- | --- | --- |
| GET | /api/v1/machines/{machineId}/slots | ADMIN, STAFF |
| GET | /api/v1/machines/{machineId}/slots/{slotId} | ADMIN, STAFF |
| POST | /api/v1/machines/{machineId}/slots | ADMIN |
| PUT | /api/v1/machines/{machineId}/slots/{slotId} | ADMIN |
| PATCH | /api/v1/machines/{machineId}/slots/{slotId}/status | ADMIN |

Bearer JWT required for an ACTIVE account; current database roles reload per request.
Existing machine HTTP guards apply to nested routes before request parsing. Controller
and service method guards reuse ADMIN/STAFF RBAC. Anonymous/invalid/expired token or
unavailable account -> 401; insufficient role -> 403. No public kiosk endpoint.

## Identity, capacity and status

POST accepts only slotCode and capacity. Code is stripped/uppercase with Locale.ROOT
before validation, nonblank, maximum 32 characters, immutable and unique per machine.
Different machines may reuse A1; no hardware naming pattern is imposed.
Duplicate normalized code -> 409; DB UNIQUE(machine_id,slot_code) is the final concurrency
guard, returning safe 409 without exposing constraint contents.

Capacity is a required positive 32-bit JSON integer token (1..2147483647). Fractional
numbers, decimal tokens such as 6.0, numeric strings, booleans and overflow are rejected
with 400 rather than coerced. No fixed number of slots or fixed capacity is enforced.
Capacity is maximum physical storage, not stock. Inventory occupancy validation is
deliberately deferred to Inventory Management; no fake inventory check is introduced.

Parent machine must exist (404 otherwise). INACTIVE/MAINTENANCE/ACTIVE parents all permit
configuration. New slots explicitly default ACTIVE; machine availability is separate.
PUT accepts only capacity. PATCH accepts only the status string ACTIVE, INACTIVE or ERROR;
numeric ordinals/unknown values are rejected. Same-status requests are idempotent.
ADMIN can set ERROR manually; automatic hardware detection is outside this issue.
Slot status does not modify parent machine status.

Detail/update/status queries always scope slotId to machineId; a slot in another machine
returns 404 and remains unchanged. Capacity/status writes lock the slot row within the
service transaction to prevent stale updates overwriting each other's fields.
Unknown, immutable and unrelated Product/Batch/Inventory/hardware fields are rejected.
No DELETE endpoint: authenticated ADMIN gets 405. Disable using INACTIVE; related
inventory/dispense histories are preserved, with no cascaded workflow changes.

DTOs expose id, machineId, slotCode, capacity, status, createdAt, updatedAt only.
UTC Instant/ISO-8601 timestamps; no recursive Machine/slots/inventory serialization.
The mapper uses the parent identifier so newly created slots also return machineId
before Hibernate hydrates the entity's read-only FK mirror.
Common ApiResponse/ApiErrorResponse reused. Success 200/201; no-store headers;
201 includes relative machine-scoped Location, 401 includes WWW-Authenticate: Bearer.

## Listing

GET /api/v1/machines/{machineId}/slots?page=0&size=20&status=ACTIVE&sort=slotCode,asc

Database paging defaults page 0, size 20; nonnegative page and size 1..100 required.
Response data: content, page, size, totalElements, totalPages. Only slots in the requested
machine are considered. Missing parent -> 404; existing parent with no slots -> empty
page. Out-of-range pages are empty with matching totals preserved.
Optional status filters ACTIVE/INACTIVE/ERROR; all statuses visible by default.
One approved sort field: id, slotCode, capacity, status, createdAt, updatedAt.
Direction asc/desc is case-insensitive; omitted direction means asc; omitted/empty
sort defaults slotCode,asc. UUID ascending breaks ties except when sorting by id.
Invalid query/sort returns safe 400. No in-memory paging or complex search framework.

## Swagger and frontend contract

With existing root .env/PostgreSQL, API_DOCS_ENABLED=true, valid JWT_SECRET and port 8080:

- Swagger UI: http://localhost:8080/swagger-ui/index.html
- OpenAPI JSON: http://localhost:8080/v3/api-docs
- OpenAPI YAML: http://localhost:8080/v3/api-docs.yaml
- Versioned contract: repository-root api-contract/api.yaml, tag Machine Slots.

From the backend module:

```powershell
mvn spring-boot:run '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC'
```

Login via Auth, Authorize with the token alone, then GET slots for an isolated machine UUID.
Use disposable development data for POST/PUT/PATCH checks. Production docs remain disabled.

## Verification

MachineSlotManagementIntegrationTest verifies real JWT/RBAC, parent existence/scoping,
normalization/immutable fields, per-machine uniqueness + DB race, initial ACTIVE,
provisioning for every parent status, positive integer bounds/strict JSON, DB paging/
filter/sort, service guards, concurrent capacity/status writes and historical fixture
preservation. Future domain fixtures are test SQL only, not additional business workflows.
MachineSlotManagementDocumentationTest loads Swagger UI/config/OpenAPI, compares complete
slot operations and seven schemas against api-contract, validates all local references
and independently checks DTO shape/code length/capacity range/status enum.

Run mvn clean verify with Java 21 and Docker. PostgreSQL 18 Testcontainers apply/validate
all eight migrations and Hibernate ddl-auto=validate with .env import disabled.
See backend/.ai/CURRENT_TASK.md and HANDOFF.md for actual evidence, UI limitations and Git status.
