# User/Role persistence — issue #5

Implements [issue #5](https://github.com/hoaifpt/Fruit_Vending_Machine/issues/5) on
`feature/5-user-role-persistence`, based on `origin/dev` at `b134a83`.

## Existing schema and mapping

Reuse `user.entity.User`, `Role`, `UserRole`, `UserRoleId`, `user.enums.UserStatus`.
V1 defines users/roles/user_roles; V8 seeds ADMIN/STAFF. No migrations/dependencies changed.
UUID, Instant, auditing and `ddl-auto=validate` remain unchanged. User has created_at and
updated_at; Role has created_at only, so it does not inherit an updated_at column.

`UserRole` remains the single writable mapping of the composite PK (user_id, role_id).
It predates this issue and preserves explicit membership lifecycle and the existing
19-table mapping/round-trip verification. This is the justified existing-mapping
exception to the issue's reference ManyToMany example, not a newly-created join entity.
Do not add a second writable ManyToMany or cascade REMOVE/ALL into shared roles.
The existing inverse Role collection is retained for compatibility, not expanded.

## Repositories and role names

- `UserRepository extends JpaRepository<User, UUID>`:
  `findByEmail(String)`, `existsByEmail(String)`, `findWithRolesByEmail(String)`.
- `RoleRepository extends JpaRepository<Role, UUID>`: `findByName(String)` and a
  typed `findByName(RoleName)` convenience overload for ADMIN/STAFF.
- `Role.name` stays String: the schema permits additional uppercase trimmed names.
  RoleName identifies the two known system roles; it is not a persisted/closed enum.

Queries use exact stored values. V1 requires lowercase trimmed email, uppercase trimmed
role name, and UNIQUE constraints. Future request/service normalization belongs to its
issue; repositories do not silently change inputs. `existsByEmail` is advisory and does
not prevent races; the DB UNIQUE constraint is the final guard.

## Fetching and membership lifecycle

Normal `findByEmail` keeps memberships LAZY. `findWithRolesByEmail` uses an explicit
`@EntityGraph(attributePaths = "roleMemberships.role")` to load zero/one/multiple roles
in one SQL query, verified against PostgreSQL. Nested attribute paths are supported by
[Spring Data JPA](https://docs.spring.io/spring-data/jpa/reference/3.5/api/java/org/springframework/data/jpa/repository/EntityGraph.html).

`User.getRoles()` derives an unmodifiable Set<Role> from memberships; it does not create
another JPA association or API DTO. Read it inside a transaction, or use the explicit
fetch method before detaching. It requires loaded memberships and nested roles when
used outside a persistence context. Do not expose these entities from REST endpoints.

Persist a UserRole explicitly with managed/persisted User and Role references; remove
the membership explicitly to revoke it. This is persistence, not an authorization policy:

```java
UserRole membership = new UserRole();
membership.setUser(user);
membership.setRole(role);
entityManager.persist(membership);
```

Owning fields are UserRole.user/role. Inverse collections are not automatically updated
after separately persisting/removing a membership; flush and refresh/reload before
reading them. PostgreSQL's composite PK rejects duplicate assignments. User deletion
cascades membership rows at DB level only; shared Role records survive. Prefer user
deactivation once user-management/history policies are implemented.

## Verification and non-goals

With Java 21, Maven and Docker Desktop, from the backend module:

```powershell
mvn -Dtest=UserRolePersistenceTest test
mvn clean verify
```

The dedicated DataJpaTest imports JpaConfig auditing, disables embedded DB replacement,
uses isolated PostgreSQL 18 Testcontainers and runs Flyway before Hibernate validation.
Tests cover CRUD/reload, UUIDs/timestamps, exact email lookup/existence, missing results,
ADMIN/STAFF and extensible role names, all three user statuses, duplicate email/member
constraints, invalid status, lazy lookup, one-query role fetching and shared-role safety.
Existing context/schema/health/exception tests remain part of the full suite.

Verified: focused suite **17 tests**, full `mvn clean verify` **28 tests**; zero failures,
errors or skips, BUILD SUCCESS and executable JAR packaged. Both use PostgreSQL 18.6,
with successful Flyway/Hibernate validation. Migrations V1–V8 remain unchanged.

No controllers, APIs, login, registration, password hashing workflow, JWT, security,
authorization, business service, payment/MQTT/dispense work is included. Apps and firmware
are unchanged. No database seed accounts or plaintext passwords are introduced.
