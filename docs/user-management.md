# User Management API — issue #12

The five management operations require an ACTIVE account with ADMIN membership.
STAFF receives 403; missing/invalid/expired JWT or unavailable accounts receive 401.
Reuse the existing public login, initial-admin bootstrap and stateless JWT authorization.

| Method | Path | Success | Purpose |
| --- | --- | --- | --- |
| GET | /api/v1/users | 200 | Database-paginated account profiles |
| GET | /api/v1/users/{id} | 200 | Safe profile and current role names |
| POST | /api/v1/users | 201 + Location | Create ACTIVE STAFF |
| PUT | /api/v1/users/{id} | 200 | Replace fullName/phone |
| PATCH | /api/v1/users/{id}/status | 200 | Change account availability |

Every success follows `ApiResponse` (timestamp/message/data), with Cache-Control: no-store.
UserResponse includes id, email, fullName, nullable phone, status, distinct role names,
createdAt/updatedAt UTC instants. It never includes passwords, hashes or tokens.
The list data contains content/page/size/totalElements/totalPages.

## Pagination and filtering

GET /api/v1/users?page=0&size=20&status=ACTIVE&role=STAFF

Page defaults to 0, size to 20; valid size is 1–100. Status and role filters are optional,
combined by AND; enums are case-sensitive (ACTIVE/INACTIVE/LOCKED and ADMIN/STAFF).
Invalid parameters return 400. An out-of-range page returns empty content with matching
totals. Ordering is createdAt DESC, id ASC. Pagination occurs in PostgreSQL before roles
are fetched for only the current page; multi-role users are returned once with all roles.
Accounts without roles and existing ADMIN accounts are visible in unfiltered results.

## Creating STAFF and editing profiles

POST accepts only email/password/fullName/optional phone. Email is stripped/lowercased
before validation, matching login/bootstrap. Email max 254; fullName nonblank/max 200
(stripped on save); phone optional/max 32, without an invented country-specific pattern.
The shared password policy requires PASSWORD_MIN_LENGTH Unicode code points (default 12,
configuration range 8–72), nonblank and at most 72 UTF-8 bytes. Passwords are never trimmed;
the existing BCrypt PasswordEncoder stores only their hashes. Login keeps accepting
existing valid passwords and does not enforce the account-creation minimum retroactively.

Creation atomically writes the user and explicit STAFF membership. Server assigns ACTIVE
and STAFF. Missing seeded STAFF fails with a generic 500, creates no account/role, and
requires operator investigation of role seeding. Duplicate email precheck returns 409;
the unchanged database UNIQUE constraint also guards races with a safe common 409.

PUT requires fullName and replaces optional phone; omitted/null phone clears it. Only
those profile fields can change, including on existing administrators. Email, password,
passwordHash, roles, status, id and timestamps are rejected with 400. Dedicated strict
DTOs also reject extra fields on POST and PATCH. No DELETE route exists.

## Status safety and transaction boundaries

PATCH accepts only a non-null status: ACTIVE (usable), INACTIVE (disabled), LOCKED
(blocked). It preserves the account, memberships and historical links. Same-status
requests are idempotent. Existing JWT account checks prevent disabled/locked users from
logging in or reusing an old token; reactivation enables login again.

Self-disable/self-lock returns 409. The last ACTIVE administrator cannot be disabled or
locked. In normal API use the active acting ADMIN is either the target (self protection)
or another remaining ADMIN. PostgreSQL advisory transaction lock FVM operation 2
serializes all status decisions across app instances. READ_COMMITTED rechecks the actor
after locking; an actor disabled by a concurrent administrator receives 403 before it
can disable the remaining ADMIN. A defensive active-admin count additionally protects
the target. Row locks serialize profile/status writes to avoid stale entity overwrites.
Locks end at commit/rollback; there are no external waits inside these transactions.
Direct administrative SQL/role writes are outside this API's concurrency protocol.

UserService is protected by existing @PreAuthorize("hasRole('ADMIN')") and transaction
proxies. The real users HTTP paths also require ADMIN before MVC binding/validation.
Actor identity comes from the trusted AuthenticatedUser security context, never request
data. This supports future audit integration without adding a complete audit subsystem.

## Common errors

- 400: malformed body/UUID, unknown fields, validation or invalid page/filter/status.
- 401: missing/invalid/expired bearer token or unavailable account; WWW-Authenticate: Bearer.
- 403: lacks ADMIN or actor became unavailable while waiting for a status decision.
- 404: account UUID not found for GET/PUT/PATCH.
- 409: duplicate email, self-lockout, last-admin conflict or database integrity race.
- 500: unexpected server/configuration error; generic message only.

The existing ApiErrorResponse has timestamp/status/error/message/path and optional
fieldErrors; no rejected values, SQL, stack trace or credentials are returned.

## Local startup and Swagger

Follow [JWT setup](jwt-authentication.md) and [Initial Admin Bootstrap](initial-admin-bootstrap.md).
Keep the existing ignored root .env with DB settings, valid JWT_SECRET and API_DOCS_ENABLED=true.
The existing application config imports root .env when Maven runs from the backend module.
Start PostgreSQL using the existing Compose instructions, then from backend/:

```powershell
mvn spring-boot:run '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC'
```

Default SERVER_PORT=8080:

- Swagger UI: http://localhost:8080/swagger-ui/index.html
- OpenAPI JSON: http://localhost:8080/v3/api-docs
- OpenAPI YAML: http://localhost:8080/v3/api-docs.yaml

Use Auth/login with your development ADMIN, then Authorize with the returned token alone
(omit Bearer). Users contains the five protected operations; GET users is a safe first
Try it out. Request examples contain placeholders; replace the password in your local
browser when testing creation on isolated data. Production profile disables documentation.
Frontend source of truth: repository-root api-contract/api.yaml, updated in this issue.

## Verification

Run `mvn clean verify` from the module with Java 21 and Docker. Tests use isolated
PostgreSQL 18, synthetic accounts and ephemeral signing keys, without reading root .env.
UserManagementIntegrationTest covers every endpoint, ADMIN/STAFF/anonymous behavior,
validation, profile restrictions, password encoding, status/login/token lifecycle,
atomic rollback, database uniqueness race and concurrent ADMIN lockout protection.
It enables Hibernate's failure on collection-fetch pagination to enforce DB pagination.
UserManagementDocumentationTest checks UI/config/document GETs and semantically compares
all user operations, parameters, examples, responses/headers/security and schema validation
with api-contract/api.yaml; local references must resolve. Existing tests cover all 19
entity mappings, Flyway V1–V8, validate-only Hibernate, bootstrap, JWT and method RBAC.

No schema/entity/dependency change, public registration, ADMIN creation, role-management,
password/email-change flow, hard delete, refresh tokens or unrelated business feature.
