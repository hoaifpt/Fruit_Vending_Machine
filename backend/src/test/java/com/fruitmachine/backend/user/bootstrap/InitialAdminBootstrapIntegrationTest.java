package com.fruitmachine.backend.user.bootstrap;

import com.fruitmachine.backend.config.properties.InitialAdminProperties;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.entity.UserRole;
import com.fruitmachine.backend.user.enums.UserStatus;
import com.fruitmachine.backend.user.repository.RoleRepository;
import com.fruitmachine.backend.user.repository.UserRepository;
import com.fruitmachine.backend.user.repository.UserRoleRepository;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;

@SpringBootTest(properties = "spring.config.import=")
@Testcontainers
@ExtendWith(OutputCaptureExtension.class)
class InitialAdminBootstrapIntegrationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18");
    static final String PASSWORD = "Test-only-bootstrap-passphrase!";
    static final String EMAIL = "initial-admin@example.invalid";
    static final String KEY = key();

    static String key() {
        byte[] bytes = new byte[32];
        new java.security.SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> EMAIL);
        registry.add("app.bootstrap.admin.password", () -> PASSWORD);
    }

    @Autowired InitialAdminBootstrapService service;
    @Autowired UserRepository users;
    @Autowired RoleRepository roles;
    @Autowired PasswordEncoder encoder;
    @Autowired JdbcTemplate jdbc;
    @Autowired Flyway flyway;
    @MockitoSpyBean UserRoleRepository memberships;

    @BeforeEach
    void resetDisposableDatabase() {
        // This class owns its isolated container; never runs against the developer's database.
        jdbc.update("DELETE FROM user_roles");
        jdbc.update("DELETE FROM users");
    }

    InitialAdminProperties configuration() {
        return new InitialAdminProperties(EMAIL, PASSWORD, "Initial Test Administrator");
    }

    User admin() {
        return users.findWithRolesByEmail(EMAIL).orElseThrow();
    }

    @Test
    void createsExactlyOneActiveAdminWithExistingRoleAndEncodedPassword(CapturedOutput output) {
        assertThat(service.bootstrap(configuration())).isTrue();
        User user = admin();
        assertThat(users.count()).isEqualTo(1);
        assertThat(user.getEmail()).isEqualTo(EMAIL);
        assertThat(user.getStatus()).isEqualTo(UserStatus.ACTIVE);
        assertThat(user.getFullName()).isEqualTo("Initial Test Administrator");
        assertThat(user.getRoles()).extracting(r -> r.getId())
                .containsExactly(roles.findByName("ADMIN").orElseThrow().getId());
        assertThat(user.getPasswordHash()).startsWith("$2a$").isNotEqualTo(PASSWORD);
        assertThat(encoder.matches(PASSWORD, user.getPasswordHash())).isTrue();
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        assertThat(output.getAll()).doesNotContain(PASSWORD, user.getPasswordHash(), KEY, EMAIL);
    }

    @Test
    void repeatedBootstrapLeavesEntireExistingAccountUnchanged() {
        service.bootstrap(configuration());
        var before = jdbc.queryForMap("SELECT * FROM users WHERE email = ?", EMAIL);
        var membershipsBefore = jdbc.queryForList("SELECT * FROM user_roles");
        assertThat(service.bootstrap(new InitialAdminProperties("another@example.invalid", "another-test-password!", "Other"))).isFalse();
        assertThat(users.count()).isEqualTo(1);
        assertThat(jdbc.queryForMap("SELECT * FROM users WHERE email = ?", EMAIL)).isEqualTo(before);
        assertThat(jdbc.queryForList("SELECT * FROM user_roles")).isEqualTo(membershipsBefore);
    }

    @ParameterizedTest
    @EnumSource(UserStatus.class)
    void existingAdminEvenUnavailableSkipsMissingAndInvalidCredentials(UserStatus status) {
        service.bootstrap(configuration());
        jdbc.update("UPDATE users SET status = ? WHERE email = ?", status.name(), EMAIL);
        var before = jdbc.queryForMap("SELECT * FROM users WHERE email = ?", EMAIL);
        var membershipsBefore = jdbc.queryForList("SELECT * FROM user_roles");
        assertThat(service.bootstrap(new InitialAdminProperties(null, null, null))).isFalse();
        assertThat(service.bootstrap(new InitialAdminProperties("invalid", "short", "x".repeat(201)))).isFalse();
        assertThat(users.count()).isEqualTo(1);
        assertThat(jdbc.queryForMap("SELECT * FROM users WHERE email = ?", EMAIL)).isEqualTo(before);
        assertThat(jdbc.queryForList("SELECT * FROM user_roles")).isEqualTo(membershipsBefore);
    }

    @Test
    void missingAdminRoleFailsWithoutPartialUserOrReplacement() {
        var role = roles.findByName("ADMIN").orElseThrow();
        roles.deleteById(role.getId());
        try {
            assertThatThrownBy(() -> service.bootstrap(configuration())).isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("required ADMIN role does not exist").hasMessageNotContaining(PASSWORD);
            assertThat(users.count()).isZero();
            assertThat(memberships.count()).isZero();
            assertThat(roles.findByName("ADMIN")).isEmpty();
            assertThat(roles.count()).isEqualTo(1);
        } finally {
            jdbc.update("INSERT INTO roles(id, name, description) VALUES (?, 'ADMIN', ?)", role.getId(), role.getDescription());
        }
    }

    @Test
    void missingConfigurationIdentifiesOnlyMissingKeys() {
        assertThatThrownBy(() -> service.bootstrap(new InitialAdminProperties("", "", null)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("INITIAL_ADMIN_EMAIL", "INITIAL_ADMIN_PASSWORD");
        assertThatThrownBy(() -> service.bootstrap(new InitialAdminProperties(null, PASSWORD, null)))
                .hasMessageContaining("INITIAL_ADMIN_EMAIL").hasMessageNotContaining(PASSWORD);
        assertThatThrownBy(() -> service.bootstrap(new InitialAdminProperties(EMAIL, null, null)))
                .hasMessageContaining("INITIAL_ADMIN_PASSWORD").hasMessageNotContaining(EMAIL);
        assertThat(users.count()).isZero();
        assertThat(memberships.count()).isZero();
    }

    @Test
    void existingStaffEmailFailsWithoutEscalationOrOtherChanges() {
        User staff = new User();
        staff.setEmail(EMAIL);
        staff.setFullName("Existing staff");
        staff.setPasswordHash(encoder.encode("Different-test-passphrase!"));
        staff.setStatus(UserStatus.LOCKED);
        staff = users.saveAndFlush(staff);
        UserRole membership = new UserRole();
        membership.setUser(staff);
        membership.setRole(roles.findByName("STAFF").orElseThrow());
        memberships.saveAndFlush(membership);
        var before = jdbc.queryForMap("SELECT * FROM users WHERE email = ?", EMAIL);
        var membershipsBefore = jdbc.queryForList("SELECT * FROM user_roles");
        assertThatThrownBy(() -> service.bootstrap(configuration())).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("belongs to an existing account").hasMessageNotContaining(EMAIL).hasMessageNotContaining(PASSWORD);
        assertThat(users.count()).isEqualTo(1);
        assertThat(admin().getRoles()).extracting(r -> r.getName()).containsExactly("STAFF");
        assertThat(jdbc.queryForMap("SELECT * FROM users WHERE email = ?", EMAIL)).isEqualTo(before);
        assertThat(jdbc.queryForList("SELECT * FROM user_roles")).isEqualTo(membershipsBefore);
    }

    @Test
    void membershipFailureRollsBackUserAndReleasesLock() {
        doThrow(new IllegalStateException("Simulated membership persistence failure")).when(memberships).saveAndFlush(any(UserRole.class));
        try {
            assertThatThrownBy(() -> service.bootstrap(configuration())).hasMessageContaining("Simulated membership");
            assertThat(users.count()).isZero();
            assertThat(memberships.count()).isZero();
        } finally {
            reset(memberships);
        }
        assertThat(service.bootstrap(configuration())).isTrue();
    }

    @Test
    void concurrentTransactionsWithDifferentEmailsCreateOnlyOneAdmin() throws Exception {
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        Callable<Boolean> first = () -> {
            ready.countDown();
            if (!start.await(10, TimeUnit.SECONDS)) throw new AssertionError("Start timeout");
            return service.bootstrap(configuration());
        };
        Callable<Boolean> second = () -> {
            ready.countDown();
            if (!start.await(10, TimeUnit.SECONDS)) throw new AssertionError("Start timeout");
            return service.bootstrap(new InitialAdminProperties("second@example.invalid", PASSWORD, null));
        };
        try (var executor = Executors.newFixedThreadPool(2)) {
            var one = executor.submit(first);
            var two = executor.submit(second);
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(List.of(one.get(20, TimeUnit.SECONDS), two.get(20, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(true, false);
        }
        assertThat(users.count()).isEqualTo(1);
        assertThat(memberships.count()).isEqualTo(1);
        assertThat(users.existsByRoleMemberships_Role_Name("ADMIN")).isTrue();
    }

    @Test
    void normalizesEmailDefaultsNameAndPreservesPasswordWhitespace() {
        String password = " " + PASSWORD + " ";
        service.bootstrap(new InitialAdminProperties("  INITIAL-ADMIN@EXAMPLE.INVALID  ", password, "   "));
        assertThat(admin().getEmail()).isEqualTo(EMAIL);
        assertThat(admin().getFullName()).isEqualTo("Initial Administrator");
        assertThat(encoder.matches(password, admin().getPasswordHash())).isTrue();
        assertThat(encoder.matches(password.strip(), admin().getPasswordHash())).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"invalid", "missing-domain@", ""})
    void invalidEmailDoesNotCreateUserOrLeakValue(String email) {
        assertThatThrownBy(() -> service.bootstrap(new InitialAdminProperties(email, PASSWORD, null)))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("INITIAL_ADMIN_EMAIL")
                .hasMessageNotContaining(PASSWORD);
        assertThat(users.count()).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"short", "           "})
    void weakPasswordFailsWithoutExposingValue(String password) {
        assertThatThrownBy(() -> service.bootstrap(new InitialAdminProperties(EMAIL, password, null)))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("INITIAL_ADMIN_PASSWORD")
                .hasMessageNotContaining(password);
        assertThat(users.count()).isZero();
    }

    @Test
    void rejectsOversizedEmailNameAndMultibytePasswordBeforePersistence() {
        for (var config : List.of(new InitialAdminProperties("a".repeat(255) + "@example.invalid", PASSWORD, null),
                new InitialAdminProperties(EMAIL, PASSWORD, "x".repeat(201)),
                new InitialAdminProperties(EMAIL, "ấ".repeat(25), null))) {
            assertThatThrownBy(() -> service.bootstrap(config)).isInstanceOf(IllegalStateException.class)
                    .hasMessageNotContaining(config.password());
            assertThat(users.count()).isZero();
        }
    }

    @Test
    void configurationToStringIsRedacted() {
        assertThat(configuration().toString()).doesNotContain(EMAIL, PASSWORD, "Initial Test Administrator");
    }
}
