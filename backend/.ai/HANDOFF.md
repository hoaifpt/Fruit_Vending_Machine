# Chat handoff - Issue #48, 2026-11-09

Repository C:/Users/north/Documents/School/9/FruitMachine/backend, Spring module backend/.
Issue https://github.com/hoaifpt/Fruit_Vending_Machine/issues/48, [BE] Implement Permission-based Authorization.
Branch feature/48-permission-authorization from origin/dev 27874b5. Git delivery: see the final report; do not assume commit/push/PR/merge happened.

Delivered: V13 `permissions` (15 codes, fixed UUIDs 20000000-...-0000000000NN) and `role_permissions` (ADMIN all, STAFF PRODUCT_READ, MACHINE_READ,
BATCH_READ, BATCH_CREATE, INVENTORY_READ, INVENTORY_WRITE, ORDER_READ = previous access). Permission / RolePermission entities, Role.getPermissions().
Authorities = ROLE_* + permission codes, loaded per request in one SQL statement (UserRepository.findWithAuthorities*); JWT `roles` claim still ROLE_* only.
All 50 ADMIN/STAFF role checks replaced by `Permissions.HAS_*` (URL rules in SecurityConfig + @PreAuthorize, read/write split per method); kiosk keeps hasRole('KIOSK').
APIs (PERMISSION_MANAGE): GET /api/v1/permissions, GET /api/v1/roles, GET /api/v1/roles/{id}, PUT /api/v1/roles/{id}/permissions
(400 unknown/duplicate, 404, 409 when ADMIN would lose PERMISSION_MANAGE or USER_WRITE, PESSIMISTIC_WRITE on the role row, audit ROLE_PERMISSIONS_CHANGED).
Swagger `x-required-permission` per operation (OperationCustomizer reading @PreAuthorize); api-contract/api.yaml synced. Docs: docs/permission-authorization.md, .ai ARCHITECTURE §23, DATABASE §16.

Verification: `mvn clean verify` 655 tests, 0 failures. AuthorizationMatrixIntegrationTest compares every api.yaml operation x {anon, STAFF, ADMIN, KIOSK}
with src/test/resources/security/authorization-matrix-baseline.tsv recorded on the old code (`-Dmatrix.record=true` rewrites it: only on purpose).
Open: #47 JMeter suite is in `git stash@{0}`; its finding (connection-pool deadlock under burst webhooks: AFTER_COMMIT listener -> REQUIRES_NEW needs a 2nd connection) awaits the recreated issue.
Environment: JAVA_HOME=C:/Program Files/Java/jdk-21.0.10, Docker Desktop running, always `mvn clean ...`.
