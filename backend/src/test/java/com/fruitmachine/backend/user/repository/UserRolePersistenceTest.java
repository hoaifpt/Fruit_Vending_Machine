package com.fruitmachine.backend.user.repository;

import com.fruitmachine.backend.config.JpaConfig;
import com.fruitmachine.backend.user.entity.Role;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.entity.UserRole;
import com.fruitmachine.backend.user.enums.RoleName;
import com.fruitmachine.backend.user.enums.UserStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import java.util.Set;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.hibernate.Hibernate;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DataJpaTest(properties = {
        "spring.config.import=",
        "spring.jpa.hibernate.ddl-auto=validate",
        "spring.jpa.properties.hibernate.generate_statistics=true"
}, showSql = false)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(JpaConfig.class)
@Testcontainers
class UserRolePersistenceTest {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18");

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    private final UserRepository users;
    private final RoleRepository roles;
    private final EntityManager entityManager;
    private final EntityManagerFactory entityManagerFactory;
    private final JdbcTemplate jdbc;
    private final Flyway flyway;

    @Autowired
    UserRolePersistenceTest(UserRepository users, RoleRepository roles, EntityManager entityManager,
            EntityManagerFactory entityManagerFactory, JdbcTemplate jdbc, Flyway flyway) {
        this.users = users;
        this.roles = roles;
        this.entityManager = entityManager;
        this.entityManagerFactory = entityManagerFactory;
        this.jdbc = jdbc;
        this.flyway = flyway;
    }

    @Test
    void persistsAndUpdatesUserWithUuidAndAuditing() {
        User user = newUser("persist@example.com");
        user.setPhone("0900000000");
        users.saveAndFlush(user);
        UUID id = user.getId();
        var createdAt = user.getCreatedAt();
        assertThat(id).isNotNull();
        assertThat(createdAt).isNotNull();
        entityManager.clear();

        User loaded = users.findById(id).orElseThrow();
        assertThat(loaded.getEmail()).isEqualTo("persist@example.com");
        assertThat(loaded.getPasswordHash()).isEqualTo(user.getPasswordHash());
        assertThat(loaded.getFullName()).isEqualTo("Persistence fixture");
        assertThat(loaded.getPhone()).isEqualTo("0900000000");
        assertThat(loaded.getStatus()).isEqualTo(UserStatus.ACTIVE);
        loaded.setFullName("Updated fixture");
        users.saveAndFlush(loaded);
        entityManager.clear();

        User updated = users.findById(id).orElseThrow();
        assertThat(updated.getFullName()).isEqualTo("Updated fixture");
        assertThat(updated.getCreatedAt()).isEqualTo(createdAt);
        assertThat(updated.getUpdatedAt()).isAfterOrEqualTo(createdAt);
    }

    @Test
    void findsUsersByExactEmailAndChecksExistenceIncludingMissingUsers() {
        User user = users.saveAndFlush(newUser("lookup@example.com"));
        entityManager.clear();
        assertThat(users.findByEmail("lookup@example.com")).get().extracting(User::getId)
                .isEqualTo(user.getId());
        assertThat(users.existsByEmail("lookup@example.com")).isTrue();
        assertThat(users.findByEmail("missing@example.com")).isEmpty();
        assertThat(users.findWithRolesByEmail("missing@example.com")).isEmpty();
        assertThat(users.existsByEmail("missing@example.com")).isFalse();
        assertThat(users.findByEmail("LOOKUP@example.com")).isEmpty();
    }

    @Test
    void loadsBothSeededRolesByKnownAndStringNames() {
        for (RoleName name : RoleName.values()) {
            Role role = roles.findByName(name).orElseThrow();
            assertThat(role.getId()).isNotNull();
            assertThat(role.getCreatedAt()).isNotNull();
            assertThat(role.getName()).isEqualTo(name.name());
            assertThat(roles.findByName(name.name())).get().extracting(Role::getId).isEqualTo(role.getId());
        }
        assertThat(roles.findByName("UNKNOWN")).isEmpty();
    }

    @Test
    void persistsExtensibleRoleNameWithoutRequiringUpdatedAt() {
        Role role = new Role();
        role.setName("AUDITOR");
        role.setDescription("Persistence fixture role");
        roles.saveAndFlush(role);
        entityManager.clear();
        Role loaded = roles.findByName("AUDITOR").orElseThrow();
        assertThat(loaded.getId()).isEqualTo(role.getId());
        assertThat(loaded.getDescription()).isEqualTo(role.getDescription());
        assertThat(loaded.getCreatedAt()).isNotNull();
        assertThat(roles.findById(role.getId())).isPresent();
    }

    @ParameterizedTest
    @EnumSource(UserStatus.class)
    void persistsEveryAllowedUserStatusAsString(UserStatus status) {
        User user = newUser("status@example.com");
        user.setStatus(status);
        users.saveAndFlush(user);
        entityManager.clear();
        assertThat(users.findById(user.getId()).orElseThrow().getStatus()).isEqualTo(status);
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id = ?", String.class, user.getId()))
                .isEqualTo(status.name());
    }

    @Test
    void databaseRejectsDuplicateEmail() {
        users.saveAndFlush(newUser("unique@example.com"));
        assertThatThrownBy(() -> users.saveAndFlush(newUser("unique@example.com")))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void databaseRejectsInvalidStatus() {
        User user = users.saveAndFlush(newUser("invalid-status@example.com"));
        assertThatThrownBy(() -> jdbc.update("UPDATE users SET status = 'UNKNOWN' WHERE id = ?", user.getId()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 1, 2})
    void explicitFetchLoadsZeroOneOrMultipleRolesInOneQuery(int count) {
        User user = users.saveAndFlush(newUser("fetch@example.com"));
        for (int index = 0; index < count; index++) {
            assign(user, roles.findByName(RoleName.values()[index]).orElseThrow());
        }
        entityManager.flush();
        entityManager.clear();
        var statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        statistics.clear();

        User loaded = users.findWithRolesByEmail(user.getEmail()).orElseThrow();
        assertThat(Hibernate.isInitialized(loaded.getRoleMemberships())).isTrue();
        assertThat(loaded.getRoleMemberships()).allSatisfy(link ->
                assertThat(Hibernate.isInitialized(link.getRole())).isTrue());
        entityManager.clear();
        assertThat(loaded.getRoles()).hasSize(count);
        Set<String> expectedNames = count == 0 ? Set.of()
                : count == 1 ? Set.of("ADMIN") : Set.of("ADMIN", "STAFF");
        assertThat(loaded.getRoles()).extracting(Role::getName).containsExactlyInAnyOrderElementsOf(expectedNames);
        assertThat(statistics.getPrepareStatementCount()).isEqualTo(1);
        assertThatThrownBy(() -> loaded.getRoles().clear()).isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void normalLookupKeepsRoleMembershipsLazy() {
        User user = users.saveAndFlush(newUser("lazy@example.com"));
        assign(user, roles.findByName(RoleName.ADMIN).orElseThrow());
        entityManager.flush();
        entityManager.clear();
        User loaded = users.findByEmail(user.getEmail()).orElseThrow();
        assertThat(Hibernate.isInitialized(loaded.getRoleMemberships())).isFalse();
    }

    @Test
    void databaseRejectsDuplicateMembershipPair() {
        User user = users.saveAndFlush(newUser("duplicate-role@example.com"));
        Role role = roles.findByName(RoleName.ADMIN).orElseThrow();
        assign(user, role);
        entityManager.flush();
        assertThatThrownBy(() -> jdbc.update("INSERT INTO user_roles(user_id, role_id) VALUES (?, ?)",
                user.getId(), role.getId())).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void deletingUserRemovesMembershipsButNeverSharedRoles() {
        User first = users.saveAndFlush(newUser("delete@example.com"));
        User second = users.saveAndFlush(newUser("keep@example.com"));
        Role admin = roles.findByName(RoleName.ADMIN).orElseThrow();
        assign(first, admin);
        assign(first, roles.findByName(RoleName.STAFF).orElseThrow());
        assign(second, admin);
        entityManager.flush();
        entityManager.clear();

        users.deleteById(first.getId());
        users.flush();
        entityManager.clear();
        assertThat(users.findById(first.getId())).isEmpty();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_roles WHERE user_id = ?", Long.class,
                first.getId())).isZero();
        assertThat(roles.findByName(RoleName.ADMIN)).isPresent();
        assertThat(roles.findByName(RoleName.STAFF)).isPresent();
        assertThat(users.findWithRolesByEmail(second.getEmail()).orElseThrow().getRoles())
                .extracting(Role::getName).containsExactly("ADMIN");
    }

    @Test
    void removingMembershipDoesNotDeleteSharedRole() {
        User user = users.saveAndFlush(newUser("remove-role@example.com"));
        Role role = roles.findByName(RoleName.STAFF).orElseThrow();
        UserRole link = assign(user, role);
        entityManager.flush();
        entityManager.remove(link);
        entityManager.flush();
        entityManager.clear();
        assertThat(users.findWithRolesByEmail(user.getEmail()).orElseThrow().getRoles()).isEmpty();
        assertThat(roles.findById(role.getId())).isPresent();
    }

    @Test
    void validatesAllAppliedMigrationsAndExistingEntityMappings() {
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE success", Long.class))
                .isEqualTo(8);
        assertThat(entityManagerFactory.getProperties()).containsEntry("hibernate.hbm2ddl.auto", "validate");
        assertThat(entityManagerFactory.getMetamodel().getEntities()).hasSize(19);
    }

    private UserRole assign(User user, Role role) {
        UserRole link = new UserRole();
        link.setUser(user);
        link.setRole(role);
        entityManager.persist(link);
        return link;
    }

    private User newUser(String email) {
        User user = new User();
        user.setEmail(email);
        user.setPasswordHash("$2a$10$opaqueFixtureNotALoginCredential");
        user.setFullName("Persistence fixture");
        return user;
    }
}
