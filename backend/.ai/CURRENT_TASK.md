# Issue #6 — JWT authentication

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/6
Title: [BE] Implement JWT authentication
Branch: feature/6-jwt-authentication
Base: origin/dev at cdce811 (user manually merged issue #5 and documentation rules).

## Scope and design

POST /api/v1/auth/login with validated DTOs, Spring Security AuthenticationManager,
BCrypt PasswordEncoder, existing UserRepository and explicit ACTIVE/INACTIVE/LOCKED mapping.
A dedicated JWT service uses Boot-managed JOSE/Nimbus HS256, stable UUID sub, informational
email and ROLE_-prefixed roles snapshots, iat/exp. Reload current user and authorities by
UUID for every Bearer request; reject deleted/INACTIVE/LOCKED accounts. Never trust stale
JWT roles as authority source. Injectable Clock; expiry 1–86400 seconds, default 3600.
Base64 environment secret requires >=32 random decoded bytes; fail clearly on invalid
config without echoing it. Secret, login and response DTO toString redact sensitive values.

Public POST login and GET health; opt-in local GET Swagger/OpenAPI only. Other routes
require authentication. Stateless sessions, no Basic/form/cookie credentials, no request
cache/logout. CSRF disabled for header-only bearer auth. Present invalid/malformed headers
return generic 401, even on public routes; missing headers continue the chain.
Reuse common API response/error conventions; no entity responses or secret logging.

Changes: auth/controller,dto,service; security/jwt,user,SecurityConfig,SecurityErrorHandler;
OpenApiConfig; config/env example; UUID graph query; tests; api-contract/api.yaml; docs.
Dependencies: Security, Boot-managed oauth2-jose/Nimbus (one JWT library), springdoc 2.9.1
for Boot 3, security-test. Swagger development opt-in; prod disables it.

## Database impact

None. Flyway V1–V8 unchanged, ddl-auto=validate, generate-ddl=false.
Seed roles only; do not create production accounts/passwords. Add UUID graph lookup only.

## Non-goals

Refresh token explicitly excluded by user. No registration, user CRUD, ADMIN/STAFF endpoint
policy, password reset/verification, logout blacklist, OAuth/social login, MFA, product,
machine, inventory, payment, MQTT or dispense implementation. Apps/kiosk/firmware untouched.
No automatic commit/push/PR/merge/issue closure.

## Verification status

Complete locally. mvn clean verify passed: 69 tests, 0 failures/errors/skips; executable
JAR built. Breakdown: AuthIntegrationTest 16, ProductionDocumentationTest 1, JwtServiceTest
14, JwtAuthenticationFilterTest 10, existing UserRolePersistenceTest 17, EntityMappingTest
4, GlobalExceptionHandlerTest 7. PostgreSQL 18.6; all 8 Flyway migrations apply/validate and
all 19 JPA entities validate. Fixed clocks cover expiration; random ephemeral test keys.

Contract YAML parsing/reference resolution and exhaustive structural OpenAPI comparison
passed (paths, methods, operationId/tag/summary, request body, response statuses/examples/
headers, schema types/formats/fields/required/validation/enum/refs, security schemes).
Swagger GET smoke passes and browser Try it out at localhost:8081 returns the expected
generic 401 for dummy credentials against an isolated temporary PostgreSQL. No real user
credentials or existing DB data used. Production test verifies disabled docs, including
authenticated 404 even when API_DOCS_ENABLED=true. Login success log capture confirms
no password/hash/JWT/key output; source audit finds no sensitive authentication logging.

git diff --check passed; V1–V8 unchanged; apps/kiosk/firmware untouched. Browser test
backend stopped and its isolated disposable PostgreSQL container removed; no user
data removed. The user's normal local DB at 5433 remains stopped as found.
No incomplete issue checklist items. No refresh token or ADMIN/STAFF endpoint rules.
User authorized commit/push of issue #6 to feature/6-jwt-authentication. Delivery is
verified through Git after commit/push; the final Git handoff reports the resulting commit.
PR/merge and GitHub checkbox changes are not performed; merge remains the user's manual action.
Local setup requires a secure JWT_SECRET in the ignored .env and a running PostgreSQL;
see docs/jwt-authentication.md. Default UI: localhost:8080/swagger-ui/index.html;
JSON: localhost:8080/v3/api-docs. Temporary smoke-test service is no longer running.

## Tasks / 1. Authentication Endpoint

- [x] Create login endpoint
- [x] Validate login request
- [x] Authenticate using email and password
- [x] Generate JWT after successful authentication
- [x] Return JWT to client
- [x] Return appropriate error for invalid credentials
- [x] Do not expose password or password hash

## Testing / 23. Login Tests

- [x] ACTIVE user with correct credentials can login
- [x] Successful login returns an access token
- [x] Wrong password returns 401 Unauthorized
- [x] Unknown email returns 401 Unauthorized
- [x] Empty email is rejected
- [x] Invalid email format is rejected
- [x] Empty password is rejected
- [x] INACTIVE user cannot login
- [x] LOCKED user cannot login
- [x] Password hash is never returned

## Testing / 24. JWT Tests

- [x] Valid JWT can be generated
- [x] Token contains the expected subject
- [x] Token has issued-at information
- [x] Token has expiration
- [x] Valid token can be parsed
- [x] Valid token is accepted
- [x] Expired token is rejected
- [x] Modified token is rejected
- [x] Token signed with an incorrect key is rejected
- [x] Malformed token is rejected

## Testing / 25. Filter Tests

- [x] Request with valid Bearer token establishes authentication
- [x] Request without token does not crash the filter
- [x] Invalid Bearer token does not authenticate the request
- [x] Expired token does not authenticate the request
- [x] Malformed Authorization header is handled safely
- [x] SecurityContext is populated only for valid authentication

## Acceptance Criteria

- [x] POST /api/v1/auth/login is implemented
- [x] Login uses email and password
- [x] Password verification uses Spring Security PasswordEncoder
- [x] ACTIVE users can authenticate
- [x] INACTIVE users cannot authenticate
- [x] LOCKED users cannot authenticate
- [x] Successful login returns a signed JWT access token
- [x] JWT has a configured expiration
- [x] JWT secret/key comes from secure configuration
- [x] JWT validation detects expiration
- [x] JWT validation detects invalid signatures
- [x] Bearer token authentication is integrated with Spring Security
- [x] Backend authentication is stateless
- [x] Authenticated requests populate Spring Security context
- [x] Invalid credentials return 401
- [x] Invalid/expired tokens do not authenticate requests
- [x] Password/password hash is never exposed
- [x] Secrets/tokens are not written to logs
- [x] Authentication/JWT tests pass
- [x] Existing persistence tests continue to pass
- [x] Application starts successfully
- [x] Flyway validation still passes
- [x] Hibernate ddl-auto=validate still passes
- [x] Existing applied migrations remain unchanged
- [x] No ADMIN/STAFF endpoint authorization is implemented beyond what is necessary to represent authenticated authorities
- [x] No unrelated feature is implemented

## 26. Security Integration Tests (no source checkbox)

Verified PostgreSQL login -> JWT -> Bearer -> authenticated test-only endpoint; current
authorities, erased credentials and no sessions/cookies. Endpoint only exists in src/test,
hidden from OpenAPI. Missing credentials cannot reuse an earlier authenticated request.
Deleted/INACTIVE/LOCKED users and invalid/expired/wrong-key tokens are rejected.
403 baseline has a common safe response; no role policy is implemented.

## Additional documentation verification

- [x] Swagger UI and generated OpenAPI load — automated GET smoke plus real browser.
- [x] Safe representative request through Swagger UI — dummy login returns generic 401.
- [x] Versioned contract matches generated OpenAPI — YAML/ref validation and semantic comparison passed.
- [x] Production documentation endpoints disabled — prod integration test passed.

## Changed file groups

- auth/controller/AuthController, auth/dto/LoginRequest/LoginResponse, auth/service/AuthService.
- security/SecurityConfig/SecurityErrorHandler, security/jwt/JwtProperties/JwtService/JwtAuthenticationFilter,
  security/user/AuthenticatedUser/CustomUserDetailsService; config/OpenApiConfig.
- UserRepository UUID graph fetch, GlobalExceptionHandler authentication/access-denied mappings.
- pom.xml, application.yaml/application-prod.yaml, .env.example (placeholders only).
- JWT/filter/auth/prod documentation tests; compatibility adjustments to existing MVC/persistence tests.
- api-contract/api.yaml, docs/jwt-authentication.md, README.md, .ai context/current task.

All issue checklist items complete. Future user provisioning, refresh tokens, RBAC,
deployment HTTPS/token storage/CORS origins belong to separate issues.
