# Issue #5 — User and Role persistence

Source: https://github.com/hoaifpt/Fruit_Vending_Machine/issues/5
Title: [BE] Implement User and Role persistence layer
Branch: feature/5-user-role-persistence
Base: origin/dev at b134a83 (includes merged foundation and approved conventions).

## Scope

Reuse existing User, Role, UserRole, UserRoleId and UserStatus mappings. Add feature-owned
UserRepository and RoleRepository with email lookup/existence, role-name lookup and
an explicit User + Roles fetch operation. Represent known ADMIN/STAFF names consistently
without closing the extensible roles.name VARCHAR representation. Add PostgreSQL
persistence tests and usage/verification documentation.

## Mapping decision and risks

Retain the already-tested UserRole entity/composite ID rather than creating/replacing
the join mapping. It is the existing single writer for user_roles; it permits explicit
membership persistence/removal independently of shared Role lifecycle and preserves the
baseline's exact table/column tests. Do not introduce a second writable ManyToMany.
User.getRoles() exposes a derived, read-only Set snapshot; load roleMemberships.role via
an explicit graph when required. No new reverse Role -> Users navigation is needed.
Role.name remains String; RoleName represents known names only. Repositories do exact
lookups; future request normalization must respect lowercase/trimmed email CHECK.
Database uniqueness remains authoritative under concurrency. Verify no N+1 role loads,
no cascade deletion of shared roles, and no use of a lazy collection outside its context
unless the explicit fetch operation has loaded it.

## Database impact

None. Inspect V1/V8; keep all applied V1–V8 migrations unchanged. Keep ddl-auto=validate,
generate-ddl=false and existing timestamp/UUID auditing infrastructure. No new dependencies.

## Acceptance criteria

- User/Role/status/UUID/timestamps conform to Flyway; context and schema validate.
- UserRepository supports ID/email retrieval, existsByEmail and efficient roles fetching.
- RoleRepository supports known and extensible role-name lookups; ADMIN/STAFF seed loads.
- Users and roles persist/reload; zero/one/multiple user roles work.
- Duplicate emails and duplicate membership pairs are rejected by PostgreSQL constraints.
- User persistence/update/removal does not delete shared roles.
- Feature repositories contain queries only; all relevant tests pass against PostgreSQL 18.

## Non-goals

No controllers, DTO APIs, user business services, registration/login, password hashing
workflow, JWT, security/authentication/authorization, product/machine/inventory business
logic, payments, MQTT or dispensing. Do not modify apps/kiosk/firmware. No automatic
commit, push, PR, merge or issue closure; user requests those GitHub actions separately.

## Verification

Run focused UserRolePersistenceTest and full mvn clean verify with Docker/Testcontainers.
Recheck Flyway/Hibernate validation, unchanged migrations, scope and git diff --check.
Implementation status: implemented and locally verified. User authorized commit/push
to feature/5-user-role-persistence; merge into dev remains a manual user action.

- Focused mvn -Dtest=UserRolePersistenceTest test: 17 tests, 0 failures/errors/skips.
- Full mvn clean verify: BUILD SUCCESS, 28 tests, 0 failures/errors/skips; executable JAR built.
- PostgreSQL 18.6 Testcontainers; all eight migrations applied and validated; Hibernate validate passed.
- Explicit roles fetch verified as one SQL statement for users with 0/1/2 roles, accessible after detach.
- Existing 19-table mappings, round trips, real HTTP health and exception tests passed.
- Applied migrations, application schema configuration, apps and firmware unchanged.
- No new dependency or actual credential introduced; git diff --check passed.
