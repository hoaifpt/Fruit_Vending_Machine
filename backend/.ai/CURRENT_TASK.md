# Issue #12 — User Management API

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/12
Title: [BE] Implement User Management API
Branch: feature/12-user-management-api
Base: origin/dev at 75fdfe0 (issue #10 merged by user through PR #13).

## Scope and decisions

Implement ADMIN-only GET /api/v1/users, GET /api/v1/users/{id}, POST /api/v1/users,
PUT /api/v1/users/{id}, PATCH /api/v1/users/{id}/status. Reuse existing repositories,
JWT, method security, PasswordEncoder, common response/errors and shared creation policy.
List uses database pagination (page 0, size 20, max 100), combined optional status/role
filters, createdAt DESC/id ASC and page-bounded role fetch (no collection-fetch pagination).
Create assigns ACTIVE + STAFF server-side; strict DTOs reject extra fields. Normalize
email with strip/lowercase, preserve password bytes, require configured minimum code
points (default 12) and max 72 UTF-8 bytes. Profile replacement changes fullName/phone;
email/password/roles/status remain controlled by their dedicated flows. Timestamp DTOs
use Instant/UTC per project convention; role names remain extensible strings.
Status updates preserve histories, reject own disable/lock and last ACTIVE ADMIN removal.
PostgreSQL transaction advisory lock serializes status decisions across app instances;
READ_COMMITTED rechecks actor after lock to prevent concurrent cross-disable lockout.
OpenAPI Users tag + versioned api-contract/api.yaml must match all delivered operations.

## Database impact / non-goals

No schema/dependency change; V1–V8 unchanged and Hibernate ddl-auto=validate.
No registration, general ADMIN creation, role management, DELETE, email/password changes,
refresh tokens, full audit subsystem, product/machine/inventory/payment/IoT features.
Only backend/ + root documentation/contract; apps/frontend/kiosk/firmware out of scope.
User confirmed manual testing and authorized commit/push on 2026-10-06.
PR/merge/GitHub issue edits remain out of scope; user merges into dev manually.

## Verification status

Complete locally on 2026-10-06. Final mvn -q clean verify passed on Java 21.0.10:
177 tests, zero failures/errors/skips; executable Spring Boot JAR built.
Isolated PostgreSQL 18.6 Testcontainers; no root .env/developer database read or modified.

Evidence:
- UserManagementIntegrationTest: 53 tests. All five real endpoints via login/JWT/security;
  ADMIN success, STAFF 403/anonymous 401, expired/wrong-key/invalid JWT, role revocation;
  ACTIVE + STAFF assignment, BCrypt hash/login and no secret response/log/toString;
  strict create/update/status fields, validation/size/Unicode-byte/password minimum;
  combined DB pagination/filtering, multi-role/no-role users, preserved identity/history;
  missing UUID 404/malformed UUID 400; status disable/lock/login+old-token denial/reactivate;
  self/sole-admin conflict and concurrent cross-disable leaves one usable ADMIN;
  missing STAFF safe 500/no role creation, membership rollback and concurrent UNIQUE 409;
  DELETE unsupported. Collection-fetch pagination configured to fail, ensuring DB paging.
- UserManagementDocumentationTest: 1 test. UI/config/OpenAPI smoke; exact user operation,
  parameters, examples, responses/statuses/headers/security comparison with api-contract;
  safe schema fields/formats/required/nullability/enum/validation and local-ref checks.
- Existing 123 tests: UserRolePersistenceTest 17, AuthIntegrationTest 17,
  AuthorizationIntegrationTest 18, InitialAdminBootstrapIntegrationTest 18,
  InitialAdminStartupTest 1, AccountCredentialPolicyTest 5, EntityMappingTest 4,
  JwtAuthenticationFilterTest 10, JwtServiceTest 14, AuthorityMappingTest 9,
  SecurityErrorHandlerTest 2, GlobalExceptionHandlerTest 7, ProductionDocumentationTest 1.
  Flyway validates V1–V8, Hibernate validates all 19 business entity mappings; actual
  servlet startup/restart and production Swagger disablement verified by existing tests.
  The two older docs path assertions now include delivered user APIs and still exclude
  test-only routes. No assertion of security/credential protection was weakened.
- Actual JAR browser smoke on isolated localhost:62660/PostgreSQL: Swagger displays Auth
  and Users with all five operations; login synthetic ADMIN -> 200; Bearer Authorize ->
  GET /api/v1/users?page=0&size=20 -> 200, safe profile/roles and pagination, no-store.
  PUT profile on synthetic QA account -> 200. Generated OpenAPI URL loaded with the four
  correct paths. Screenshot: backend/target/user-management-swagger.png (ignored artifact).
  QA tab closed, Java stopped and disposable --rm DB container removed afterwards.
- Production JAR inspection excludes UserManagement tests/RbacTest/test-only fixtures.
- Source/diff audit: Flyway, entities, pom.xml, .env/.env.example, apps and firmware unchanged.
  git diff --check passes. No schema or dependency change; original JWT/RBAC pipeline reused.

All 85 original source checklist items below complete. Source section 39 (no checkboxes)
also verified by real login/JWT API tests. No implementation/verification blocker remains.
User's manual retest passed on 2026-10-06; commit/push delivery is authorized.
User handles merge into dev manually; no PR/merge/issue edits are authorized.

Swagger UI: http://localhost:8080/swagger-ui/index.html
OpenAPI JSON: http://localhost:8080/v3/api-docs
Startup: existing root .env + running PostgreSQL, API_DOCS_ENABLED=true, valid JWT_SECRET;
from backend module run mvn spring-boot:run '-Dspring-boot.run.jvmArguments=-Duser.timezone=UTC'.
See ../../docs/user-management.md. Updated frontend contract: api-contract/api.yaml.

## Source checklist (preserved under original headings)

## 34. Create STAFF Tests

- [x] ADMIN can create STAFF
- [x] Created account has `STAFF` role
- [x] Created account has `ACTIVE` status
- [x] Password is encoded
- [x] Plaintext password is not stored
- [x] Duplicate email returns `409`
- [x] Invalid email returns `400`
- [x] Blank password returns `400`
- [x] Blank full name returns `400`
- [x] Client cannot create ADMIN through this endpoint
- [x] STAFF cannot create users
- [x] Unauthenticated client cannot create users

# 35. List User Tests

- [x] ADMIN can list users
- [x] Pagination works
- [x] Status filtering works
- [x] Role filtering works
- [x] Roles are returned correctly
- [x] Status is returned correctly
- [x] Password hash is never returned
- [x] STAFF receives `403`
- [x] Unauthenticated request receives `401`

# 36. Get User Tests

- [x] ADMIN can retrieve an existing user
- [x] Missing user returns `404`
- [x] Response contains expected roles
- [x] Response does not expose password hash
- [x] STAFF receives `403`
- [x] Unauthenticated request receives `401`

# 37. Update User Tests

- [x] ADMIN can update full name
- [x] ADMIN can update phone
- [x] Missing user returns `404`
- [x] General update cannot change password
- [x] General update cannot change roles
- [x] General update cannot change status
- [x] General update cannot change email
- [x] STAFF receives `403`

# 38. Status Tests

- [x] ADMIN can set STAFF to `INACTIVE`
- [x] ADMIN can reactivate STAFF to `ACTIVE`
- [x] ADMIN can set STAFF to `LOCKED`
- [x] INACTIVE STAFF cannot authenticate
- [x] LOCKED STAFF cannot authenticate
- [x] Current ADMIN cannot disable itself
- [x] Current ADMIN cannot lock itself
- [x] Last usable ADMIN protection works where applicable
- [x] STAFF cannot change status

## 39. Security Integration Tests (source has no checkboxes)

Verified: ADMIN login -> JWT -> GET users = 200; STAFF login -> JWT -> GET users = 403;
no JWT -> GET users = 401, through the existing authorization infrastructure.

# 40. Regression Tests

- [x] User/Role persistence tests pass
- [x] JWT authentication tests pass
- [x] ADMIN/STAFF authorization tests pass
- [x] Initial Admin Bootstrap tests pass
- [x] Flyway validation passes
- [x] Hibernate schema validation passes
- [x] Application starts successfully

# Acceptance Criteria

- [x] `GET /api/v1/users` is implemented
- [x] `GET /api/v1/users/{id}` is implemented
- [x] `POST /api/v1/users` is implemented
- [x] `PUT /api/v1/users/{id}` is implemented
- [x] `PATCH /api/v1/users/{id}/status` is implemented
- [x] All User Management endpoints require ADMIN authorization
- [x] STAFF receives `403` for User Management endpoints
- [x] Unauthenticated requests receive `401`
- [x] User listing supports pagination
- [x] Basic status/role filtering works
- [x] ADMIN can create STAFF
- [x] New STAFF defaults to ACTIVE
- [x] New STAFF password is securely encoded
- [x] Duplicate email is rejected
- [x] ADMIN cannot be created through the STAFF creation endpoint
- [x] ADMIN can update allowed profile fields
- [x] Email cannot be changed through general update
- [x] Password cannot be changed through general update
- [x] Roles cannot be changed through general update
- [x] ADMIN can change STAFF status
- [x] Users are not hard-deleted
- [x] Current ADMIN self-lockout is prevented
- [x] Last usable ADMIN is protected
- [x] Password/password hash is never exposed
- [x] Existing User/Role repositories are reused
- [x] Existing JWT authentication is reused
- [x] Existing ADMIN/STAFF authorization is reused
- [x] Common API/error conventions are followed
- [x] Tests pass
- [x] Application starts successfully
- [x] Flyway validation passes
- [x] Hibernate `ddl-auto=validate` passes
- [x] Existing applied migrations remain unchanged
- [x] No unrelated feature is implemented
