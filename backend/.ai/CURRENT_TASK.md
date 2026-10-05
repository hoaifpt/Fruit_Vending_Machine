# Issue #10 — ADMIN/STAFF authorization

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/10
Title: [BE] Implement ADMIN/STAFF authorization
Branch: feature/10-admin-staff-authorization
Base: origin/dev at 1706bd2 (issue #8 merged by user through PR #11).

## Scope and design

Enable Spring Security method authorization with @EnableMethodSecurity in existing
SecurityConfig. Reuse CustomUserDetailsService/AuthenticatedUser ROLE_ mapping and
existing JWT filter; PostgreSQL current memberships remain authoritative on each request.
Keep ADMIN/STAFF independent, no hierarchy or fabricated STAFF authority for ADMIN.
Support ADMIN-only, STAFF-only, either role and any-authenticated method expressions.
Preserve public POST login/GET health, stateless bearer authentication and blocked
INACTIVE/LOCKED/deleted accounts. Reuse common 401 entry point, 403 access-denied handler
and MVC error handling; no duplicate auth pipeline or business role-check conditionals.

Changed groups: SecurityConfig method-security activation; authority mapping/method-security/
JWT integration and security-error tests; metadata in AuthController/OpenApiConfig and
api-contract/api.yaml, contract info/tag comparison test; docs/admin-staff-authorization.md,
README/JWT docs and .ai PROJECT/ARCHITECTURE/CURRENT_TASK.
Only test fixtures expose protected operations, including a Spring-managed service proxy.
Test-only routes stay hidden from generated OpenAPI and out of the production JAR.

## Database and API impact

No schema/dependency/entity changes. Flyway V1–V8 unchanged; ddl-auto=validate.
No production REST operation is added/changed; login remains public and unchanged.
Swagger/api-contract info and Auth tag descriptions now reflect the implemented RBAC
foundation. Semantic comparison includes matching info/tags, existing operation/schemas/
headers/examples/security. No test-only operation is exposed.

## Non-goals

No User Management or /api/v1/users API, CRUD/registration, bootstrap changes, password
reset, refresh tokens, dynamic roles/permission management/role hierarchy, business-domain
APIs, MQTT/payment/dispense. Apps/kiosk/firmware untouched. No automatic commit/push/PR/
merge/issue checkbox changes.

## Verification status

Complete locally. Final `mvn clean verify` passed with Java 21: 123 tests, 0 failures,
0 errors, 0 skips; executable Spring Boot JAR built. PostgreSQL 18.6 isolated Testcontainers.
No developer .env/database is read/modified, no real credential is used or introduced.

Evidence by group:
- AuthorityMappingTest: 9 tests, existing mapping reused for ADMIN/STAFF, multiple/duplicate/
  no roles, normalized username and UUID lookup, all account statuses. Existing entities
  retain immutable IDs; ReflectionTestUtils is used only for isolated unit fixtures.
- AuthorizationIntegrationTest: 18 tests, full login -> JWT -> filter -> principal/context
  -> real Spring @PreAuthorize service/controller proxy. ADMIN/STAFF/shared/any-authenticated
  allow/deny, no implicit hierarchy, duplicate-free principal and SecurityContext authorities,
  no-role user, anonymous 401 on every protected fixture, invalid/expired/wrong-key/malformed
  bearer 401, valid STAFF lacking ADMIN 403 with common safe JSON. Denied method body does
  not execute. Same JWT follows immediate DB role removal/addition despite stale role claims.
  INACTIVE/LOCKED/deleted accounts remain blocked. Context is cleared between requests;
  log capture contains no password/hash/token/key. Public login/health/docs preserved.
- SecurityErrorHandlerTest: 2 tests, existing entry point and access-denied handler produce
  common 401/403 schema, safe generic messages, expected headers and no exception details.
- AuthIntegrationTest: 17 tests, login/JWT regressions, full semantic contract comparison
  including updated info/tags, paths/methods/operationId/request/response/schemas/headers/
  examples/security; Swagger UI/OpenAPI GET smoke. No test-only paths in generated docs.
- Existing suites: ProductionDocumentationTest 1 (prod docs disabled), GlobalExceptionHandlerTest
  7, EntityMappingTest 4 (19 entities/tables/columns, Flyway V1–V8 and validate-only Hibernate),
  JwtAuthenticationFilterTest 10, JwtServiceTest 14, AccountCredentialPolicyTest 5,
  InitialAdminBootstrapIntegrationTest 18, InitialAdminStartupTest 1 (actual servlet startup
  and restart same DB without bootstrap secrets), UserRolePersistenceTest 17.
- Production JAR inspection: zero AuthorizationIntegrationTest/RbacTest/RbacOperations/
  AuthorityMappingTest/SecurityErrorHandlerTest entries. Protected fixtures only exist in
  src/test, marked test component/hidden; no production business or demo endpoint.
- Source/diff audit: no JWT/role mapping/status/bootstrap/schema/dependency implementation
  replacement, no role hierarchy, no manual business role checks. Existing Flyway/entity
  files, pom.xml, .env/.env.example and apps/kiosk/firmware remain unchanged. Whitespace
  checks pass. Authorization/no-secret logging is verified by tests and source inspection.

All 57 source checklist items complete; source sections 24/25 (no checkboxes) also verified.
No implementation blocker. At implementation completion, no Git delivery was performed.
On 2026-10-05 the user authorized commit/push: 10276d5 contains the issue #10 implementation
and guidance updates and was pushed to origin/feature/10-admin-staff-authorization.
A documentation follow-up records this delivery. PR/merge/GitHub checkbox changes NOT
performed; the user handles merge manually. See HANDOFF.md and verify current Git state.
Future features must explicitly annotate Spring-managed use-case entry points; unannotated
methods are not automatically role-protected. Self-invocation/private/final proxy limits
and non-HTTP principal trust boundaries are documented. No User Management/refresh token.

Swagger UI: http://localhost:8080/swagger-ui/index.html; OpenAPI: http://localhost:8080/v3/api-docs.
Local startup instructions remain in JWT/bootstrap docs (ignored .env, running PostgreSQL,
valid JWT_SECRET, JVM UTC); existing ADMIN makes bootstrap skip. UI/API smoke verified by
MockMvc; no browser Try it out is performed in this infrastructure-only issue, no production
role-protected operation exists to demonstrate. New metadata matches generated OpenAPI.

## 1. Integrate Roles with Spring Security

- [x] `ADMIN` maps to `ROLE_ADMIN`
- [x] `STAFF` maps to `ROLE_STAFF`
- [x] Authorities are available through the authenticated principal
- [x] Authorities are available through `SecurityContext`
- [x] Multiple roles are supported
- [x] Duplicate authorities are avoided

## 21. Authority Mapping Tests

- [x] ADMIN maps to `ROLE_ADMIN`
- [x] STAFF maps to `ROLE_STAFF`
- [x] Multiple roles map correctly
- [x] Duplicate authorities are not produced

## 22. ADMIN Authorization Tests

- [x] ADMIN can access ADMIN-only protected functionality
- [x] STAFF cannot access ADMIN-only functionality
- [x] STAFF receives `403`
- [x] unauthenticated request receives `401`

## 23. STAFF Authorization Tests

- [x] STAFF can access STAFF-protected functionality
- [x] ADMIN/STAFF shared authorization works
- [x] unauthenticated request receives `401`

## 26. Authentication Regression Tests

- [x] ACTIVE user can authenticate
- [x] invalid credentials return `401`
- [x] invalid JWT is rejected
- [x] expired JWT is rejected
- [x] INACTIVE user remains blocked
- [x] LOCKED user remains blocked
- [x] valid JWT still establishes authentication

## 27. Application Regression

- [x] Application starts successfully
- [x] Existing tests continue to pass
- [x] Flyway validation passes
- [x] Hibernate `ddl-auto=validate` passes
- [x] No unexpected database migration is introduced

## Acceptance Criteria

- [x] `ADMIN` maps to `ROLE_ADMIN`
- [x] `STAFF` maps to `ROLE_STAFF`
- [x] Authenticated users expose correct authorities
- [x] Authorities are available through Spring Security
- [x] Method security is enabled
- [x] `@PreAuthorize("hasRole('ADMIN')")` works
- [x] `@PreAuthorize("hasRole('STAFF')")` works
- [x] `@PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")` works
- [x] ADMIN can access ADMIN-protected functionality
- [x] STAFF cannot access ADMIN-only functionality
- [x] STAFF can access STAFF-allowed functionality
- [x] Missing authentication results in `401`
- [x] Invalid/expired authentication results in `401`
- [x] Authenticated user without permission receives `403`
- [x] AuthenticationEntryPoint handles unauthenticated access
- [x] AccessDeniedHandler handles forbidden access
- [x] Existing JWT authentication continues working
- [x] User account status restrictions continue working
- [x] Backend remains authoritative for authorization
- [x] No duplicate role model is introduced
- [x] No role hierarchy is introduced
- [x] No database schema change is required
- [x] Existing Flyway migrations remain unchanged
- [x] Authorization tests pass
- [x] Existing authentication tests pass
- [x] Application starts successfully
- [x] No User Management functionality is implemented
- [x] No unrelated feature is implemented

## Additional source testing requirements (no checkbox in issue)

24. Method Security Tests: actual ADMIN allow/STAFF deny through @PreAuthorize Spring proxy.
25. 401 / 403 Tests: missing/invalid/expired authentication -> 401, ADMIN allowed, STAFF -> 403.
Also verify no implicit hierarchy, immediate DB role changes, multiple/no-role accounts,
current principal/SecurityContext, safe consistent errors and no token/credential logging.
