# Issue #48 — [BE] Implement Permission-based Authorization

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/48
Branch: feature/48-permission-authorization (from origin/dev 27874b5)
Authorized: implementation and local verification. Commit/push only on request; no PR/merge. Ticking the
GitHub checkboxes of this issue is allowed after verification (AGENTS.md section 14).

## Scope
V13 (permissions, role_permissions, fixed-UUID seed of the 15-code catalog and the ADMIN/STAFF mapping), Permission entity and
RolePermission join entity (UserRole style), authorities = ROLE_* + permission codes loaded per request in one query,
JWT unchanged (roles claim keeps ROLE_* only), every ADMIN/STAFF role check replaced by hasAuthority(<permission>) at URL and method
level, role/permission APIs (list permissions, list/get roles, replace a role's permissions with lockout guard, row lock and audit),
Swagger x-required-permission + api-contract, docs.

## Mapping check (issue §3 vs current code)
Every existing @PreAuthorize and URL rule was compared with §3: no difference. Class-level annotations (User, Inventory, ProductBatch,
Order, Payment, PaymentWebhookLog, KioskCredential) are split per method (read vs write). Methods that do not exist on a protected
path keep their current status (for example 405) because every method of the path still needs a permission both roles have.

## Non-goals
Creating/renaming/deleting roles or permissions, direct user permissions, row-level access, kiosk permissions, permissions for
unbuilt features, caching, web UI, refresh tokens.

## Database / API impact
New V13 (V1-V12 untouched). New endpoints: GET /api/v1/permissions, GET /api/v1/roles, GET /api/v1/roles/{id},
PUT /api/v1/roles/{id}/permissions (tag "Roles & Permissions").

## Status and verification
Done locally, not committed. The authorization matrix baseline (192 rows) was recorded on the unchanged code (dev 27874b5) before any
change; after the change every existing operation returns the same status, new APIs: anonymous 401, kiosk 401, STAFF 403, ADMIN allowed.
`mvn clean verify` (JDK 21.0.10, PostgreSQL 18 Testcontainers): 655 tests, 0 failures, BUILD SUCCESS; Flyway validates V1-V13.
"Application starts" is covered by the Spring Boot context tests (InitialAdminStartupTest and every integration test), not by a
deployed run. Existing tests updated for intended changes: migration counts/version 13, new paths in Swagger path lists, principals
now carry permission codes (hand-built test principals use SeededAuthorities). CoreManagementFlowIntegrationTest now expires the batch
one minute in the past (DB clock vs JVM clock skew made it flaky; unrelated to #48).

# Testing

## 9. Authorization Matrix (NFR-03)

- [x] Parameterized test over **every operation in `api-contract/api.yaml`** × {anonymous, STAFF, ADMIN, KIOSK} with the expected status (`401`/`403`/allowed)
- [x] Matrix results are identical before and after the change (except new role/permission APIs)
- [x] For every endpoint, URL rule and `@PreAuthorize` require the same permission
- [x] Unauthorized request with an invalid body still gets `403`, not `400`

## 10. Migration / Mapping

- [x] V13 applies on clean PostgreSQL 18; Flyway + Hibernate validation pass
- [x] Seed contains exactly the catalog of §2 and mapping of §3
- [x] Invalid code format rejected by CHECK
- [x] Deleting a permission referenced by a role is rejected (RESTRICT)
- [x] `EntityMappingTest` covers `Permission` and `Role.permissions`

## 11. Authorities

- [x] Principal contains `ROLE_*` and permission codes
- [x] Roles + permissions loaded in one query (query count assertion)
- [x] Removing `PRODUCT_WRITE` from ADMIN → next request on product create gets `403` with the same JWT
- [x] Kiosk principal unchanged (`ROLE_KIOSK` only)

## 12. Role & Permission APIs

- [x] ADMIN lists permissions and roles
- [x] ADMIN replaces STAFF permissions; effect visible on STAFF's next request
- [x] Unknown / duplicate codes → `400`
- [x] Removing `PERMISSION_MANAGE` or `USER_WRITE` from ADMIN → `409`
- [x] Missing role → `404`
- [x] STAFF → `403`; anonymous → `401`; kiosk key → `401`
- [x] Audit row written with old/new sorted codes and actor
- [x] Concurrent replacements on one role → no lost update

## 13. Regression

- [x] No `hasRole('ADMIN')` / `hasAnyRole('ADMIN','STAFF')` left (grep check in test or CI)
- [x] All existing tests pass (`mvn clean verify`)
- [x] Swagger and `api-contract/api.yaml` consistent (documentation test)
- [x] Application starts successfully

---

# Acceptance Criteria

- [x] V13 adds `permissions` and `role_permissions` with seeded catalog and mapping
- [x] `Permission` entity and `Role.permissions` mapped
- [x] Authorities include permission codes, loaded per request in one query
- [x] All ADMIN/STAFF role checks replaced by permission checks (URL + method)
- [x] Access behavior identical to before for every existing endpoint
- [x] `403` still precedes `400` for unauthorized requests
- [x] Role & permission APIs implemented with lockout guard and audit log
- [x] Permission change applies on the next request without re-login
- [x] Kiosk and webhook access unchanged
- [x] Authorization matrix test covers every contract operation (NFR-03)
- [x] Swagger, `api-contract/api.yaml`, `.ai/` docs and `docs/permission-authorization.md` updated
- [x] Tests pass (`mvn clean verify`)
- [x] Flyway / Hibernate validation pass
- [x] Existing applied migrations unchanged

---
