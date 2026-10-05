# Issue #8 — Initial Admin Bootstrap

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/8
Title: [BE] Implement Initial Admin Bootstrap
Branch: feature/8-initial-admin-bootstrap
Base: origin/dev at d7b0833.

## Scope

Provision the first ACTIVE ADMIN through ApplicationRunner and a transactional service.
Typed environment configuration; skip before validating credentials if ANY ADMIN exists,
including INACTIVE/LOCKED. Reuse V8 ADMIN role and existing PasswordEncoder. Never overwrite
accounts or promote an existing email. PostgreSQL transaction advisory lock serializes
bootstrap instances; READ_COMMITTED sees the preceding committed administrator.
Shared account creation validation: normalized email, default minimum 12 password characters
(configurable PASSWORD_MIN_LENGTH 8–72),
maximum 72 UTF-8 bytes (BCrypt); no trimming passwords. Existing login policy unchanged.

Changed files: user/bootstrap, user/repository, config/properties, account validation,
application.yaml, .env.example, isolated tests, README/docs and this task tracker.

## Database impact

No schema change. Reuse users/roles/user_roles; Flyway V1–V8 unchanged; ddl-auto=validate.
Creation and membership assignment are atomic. No passwords/accounts in Flyway.

## Non-goals

No registration, user CRUD, password reset/rotation, refresh tokens, new role endpoint
policy, product/machine/inventory/payment/MQTT/dispensing work. Apps/kiosk/firmware untouched.
No REST API change; Swagger and api-contract retain the existing login contract.
No automatic commit, push, PR, merge or GitHub checklist mutation.

## Verification

Complete locally. `mvn clean verify` passed: 94 tests, 0 failures/errors/skips; executable
JAR built with Java 21. PostgreSQL 18.6 isolated Testcontainers; no developer DB or .env
was read/modified. Testcontainers cleaned up automatically; no containers remain.

Evidence:
- InitialAdminBootstrapIntegrationTest: 18 tests — creation/hash/matches/status/seeded
  role, complete-row/membership idempotency, all ADMIN statuses skip missing/invalid
  config, missing ADMIN role with no replacement, missing keys without values, STAFF
  conflict unchanged, membership-save failure rolls back user, two concurrent transactions
  with different emails create one ADMIN, normalization/default name/untrimmed password,
  invalid email/password/name/UTF-8 limits, redacted configuration.
- InitialAdminStartupTest: 1 multi-start test — actual servlet startup fails without
  credentials and leaves zero users; environment-variable binding provisions ADMIN;
  close context/restart same database with blank bootstrap secrets skips creation and
  preserves all user/membership columns. Success/skip log captured without credentials/hash/key.
- AccountCredentialPolicyTest: 5 tests — configurable minimum, safe invalid-policy errors,
  BCrypt 72-byte boundary and Unicode code-point minimum.
- AuthIntegrationTest: 17 tests including bootstrapped ADMIN login -> JWT -> current
  ROLE_ADMIN on test-only protected endpoint; password/hash/JWT/key absent from logs.
  Swagger/OpenAPI smoke and full semantic comparison against api-contract/api.yaml pass.
- Regression: ProductionDocumentationTest 1, GlobalExceptionHandlerTest 7,
  EntityMappingTest 4, JwtAuthenticationFilterTest 10, JwtServiceTest 14,
  UserRolePersistenceTest 17. Production docs disabled; 19 entity/table/column mappings
  validate; Flyway V1–V8 apply/validate. Hibernate never creates/repairs schema.

Source/diff audit: no production password defaults or hardcoded credentials, no credential
log statements, no dependencies or migrations changed. .env remains ignored/untracked;
.env.example INITIAL_ADMIN_EMAIL/PASSWORD and JWT_SECRET are empty placeholders.
No changes to apps/kiosk/firmware or api-contract; no REST API change requires a new
contract operation. git diff --check and new-file whitespace checks passed.

Changed groups: user/bootstrap, user repositories, reusable account-creation policy,
config/properties, application.yaml, .env.example; bootstrap/policy/startup/auth tests and
isolated fixture config in production-doc/schema tests; README, bootstrap/JWT docs and
.ai PROJECT/ARCHITECTURE/CURRENT_TASK. AGENTS.md and coding/Git rules unchanged.

No incomplete issue checklist items. User also confirmed successful local application
startup and initial ADMIN creation. User authorized commit/push to
feature/8-initial-admin-bootstrap. Initial push failed authentication; after user
re-authentication, retry succeeded. Implementation commit 1eee570 was verified against
the GitHub branch head; branch tracks origin/feature/8-initial-admin-bootstrap.
This delivery-status update is committed/pushed separately without rewriting published
history. Final Git handoff verifies the resulting remote head. No PR, merge or GitHub
checklist changes; user handles merge manually. All 58 implementation checklist items
remain complete; no outstanding authentication blocker.
Remaining operational requirement (not an implementation blocker): developer must supply
INITIAL_ADMIN_EMAIL/PASSWORD in ignored .env or environment for a DB without ADMIN.
After first provisioning, remove bootstrap secrets; JWT_SECRET remains required.
Maven/Java runtime must use UTC as documented to avoid PostgreSQL Asia/Saigon alias errors.
See docs/initial-admin-bootstrap.md. No refresh token, CRUD or endpoint RBAC added.

## 22. Security Requirements

- [x] No hardcoded admin password
- [x] No plaintext password stored in database
- [x] No real bootstrap credentials committed to Git
- [x] Password is encoded using the existing `PasswordEncoder`
- [x] Existing ADMIN accounts are never overwritten
- [x] Existing users are not silently promoted to ADMIN
- [x] Bootstrap is skipped once an ADMIN exists
- [x] Secrets are never written to logs
- [x] ADMIN role comes from the existing role model

## 23. Bootstrap Creation Test

- [x] One User is created
- [x] User has configured email
- [x] User status is `ACTIVE`
- [x] User has `ADMIN` role
- [x] Stored password is encoded
- [x] Stored password is not equal to plaintext password
- [x] Encoded password matches using `PasswordEncoder.matches(...)`

## 24. Idempotency Test

- [x] ADMIN count remains one
- [x] Existing ADMIN is unchanged

## 25. Existing ADMIN Test

- [x] Bootstrap creates no user
- [x] Existing password is unchanged
- [x] Existing email is unchanged
- [x] Existing roles are unchanged

## 26. Missing Role Test

- [x] Bootstrap fails/reports clearly
- [x] No partial user is created
- [x] No replacement role is silently created

## 27. Missing Configuration Test

- [x] Bootstrap/startup fails clearly
- [x] Error identifies missing configuration
- [x] Error does not expose password values
- [x] No partial administrator is created

## 28. Existing Email Conflict Test

- [x] Existing STAFF is NOT silently promoted
- [x] Bootstrap reports the conflict
- [x] Existing account remains unchanged

## 29. Authentication Integration Test

- [x] Bootstrapped administrator can authenticate
- [x] JWT authentication works with the account
- [x] ADMIN authority is available after authentication

## Acceptance Criteria

- [x] Application can provision the first ADMIN account
- [x] Bootstrap credentials come from environment/configuration
- [x] No real credentials are committed to Git
- [x] Initial password is encoded using the existing `PasswordEncoder`
- [x] Bootstrapped user has status `ACTIVE`
- [x] Bootstrapped user receives the existing `ADMIN` role
- [x] Existing ADMIN prevents additional bootstrap creation
- [x] Restarting the application does not create duplicate ADMIN accounts
- [x] Existing ADMIN data is never overwritten
- [x] Existing non-ADMIN account is not silently promoted
- [x] Missing ADMIN role is handled safely
- [x] Missing required bootstrap configuration is handled clearly
- [x] Bootstrap operation is transactional
- [x] Password/password hash is not exposed in logs
- [x] Bootstrapped ADMIN can login through the existing JWT authentication flow
- [x] Bootstrapped ADMIN receives the expected ADMIN authority
- [x] No unnecessary database migration is created
- [x] Existing Flyway migrations remain unchanged
- [x] Tests pass
- [x] Application starts successfully after successful bootstrap
- [x] Flyway validation passes
- [x] Hibernate `ddl-auto=validate` passes
- [x] No unrelated feature is implemented
