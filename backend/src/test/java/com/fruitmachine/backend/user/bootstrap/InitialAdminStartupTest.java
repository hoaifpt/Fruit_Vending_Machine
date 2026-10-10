package com.fruitmachine.backend.user.bootstrap;

import com.fruitmachine.backend.BackendApplication;
import com.fruitmachine.backend.config.properties.InitialAdminProperties;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.*;

@Testcontainers
@ExtendWith(OutputCaptureExtension.class)
class InitialAdminStartupTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = com.fruitmachine.backend.support.TestPostgres.create();
    static final String PASSWORD = "Startup-test-only-passphrase!";
    static final String EMAIL = "startup-admin@example.invalid";
    static final String KEY = key();

    static String key() {
        byte[] bytes = new byte[32];
        new java.security.SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }

    ConfigurableApplicationContext start(String email, String password) {
        List<String> args = new ArrayList<>(List.of("--spring.config.import=", "--server.port=0",
                "--spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                "--spring.datasource.username=" + POSTGRES.getUsername(),
                "--spring.datasource.password=" + POSTGRES.getPassword(), "--security.jwt.secret=" + KEY,
                "--INITIAL_ADMIN_EMAIL=" + email, "--INITIAL_ADMIN_PASSWORD=" + password,
                "--INITIAL_ADMIN_FULL_NAME=Startup Test Administrator", "--spring.main.banner-mode=off"));
        return new SpringApplicationBuilder(BackendApplication.class).run(args.toArray(String[]::new));
    }

    @Test
    void startupFailsWithoutConfigThenProvisionsAndRestartsWithoutSecrets(CapturedOutput output) {
        assertThatThrownBy(() -> start("", "")).isInstanceOf(IllegalStateException.class)
                .hasStackTraceContaining("missing INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD");
        org.springframework.jdbc.datasource.DriverManagerDataSource datasource =
                new org.springframework.jdbc.datasource.DriverManagerDataSource(
                        POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        JdbcTemplate probe = new JdbcTemplate(datasource);
        assertThat(probe.queryForObject("SELECT count(*) FROM users", Integer.class)).isZero();
        java.util.Map<String, Object> before;
        List<java.util.Map<String, Object>> rolesBefore;
        String hash;
        try (var application = start(EMAIL, PASSWORD)) {
            JdbcTemplate jdbc = application.getBean(JdbcTemplate.class);
            before = jdbc.queryForMap("SELECT * FROM users WHERE email = ?", EMAIL);
            rolesBefore = jdbc.queryForList("SELECT * FROM user_roles");
            hash = (String) before.get("password_hash");
            assertThat(application.isActive()).isTrue();
            assertThat(application.getBean(InitialAdminProperties.class).email()).isEqualTo(EMAIL);
            assertThat(application.getBean(Flyway.class).validateWithResult().validationSuccessful).isTrue();
            assertThat(application.getEnvironment().getProperty("spring.jpa.hibernate.ddl-auto")).isEqualTo("validate");
            assertThat(jdbc.queryForObject("SELECT count(*) FROM users", Integer.class)).isEqualTo(1);
        }
        try (var application = start("", "")) {
            JdbcTemplate jdbc = application.getBean(JdbcTemplate.class);
            assertThat(application.isActive()).isTrue();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM users", Integer.class)).isEqualTo(1);
            assertThat(jdbc.queryForMap("SELECT * FROM users WHERE email = ?", EMAIL)).isEqualTo(before);
            assertThat(jdbc.queryForList("SELECT * FROM user_roles")).isEqualTo(rolesBefore);
            assertThat(application.getBean(Flyway.class).validateWithResult().validationSuccessful).isTrue();
        }
        assertThat(output.getAll()).contains("Initial ADMIN account created successfully", "ADMIN already exists; bootstrap skipped")
                .doesNotContain(PASSWORD, hash, KEY, EMAIL);
    }
}
