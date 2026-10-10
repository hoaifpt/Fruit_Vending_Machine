package com.fruitmachine.backend.support;

import com.fasterxml.jackson.databind.ObjectMapper;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest(properties = "spring.config.import=")
@ActiveProfiles("test")
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@Testcontainers
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
public abstract class AbstractCoreIntegrationTest {
    @Container
    protected static final PostgreSQLContainer<?> POSTGRES = TestPostgres.create();
    private static final String KEY = randomKey();
    private static final String EMAIL = "core-bootstrap@example.invalid";
    protected static final String PASSWORD = "Test-only-core-passphrase!";

    private static String randomKey() {
        byte[] bytes = new byte[32];
        new java.security.SecureRandom().nextBytes(bytes);
        return java.util.Base64.getEncoder().encodeToString(bytes);
    }

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> EMAIL);
        registry.add("app.bootstrap.admin.password", () -> PASSWORD);
        registry.add("app.account.password.min-length", () -> 12);
    }

    @Autowired protected MockMvc mvc;
    @Autowired protected ObjectMapper json;
    @Autowired protected JdbcTemplate jdbc;
    @Autowired protected DataSource dataSource;
    @Autowired protected Flyway flyway;
    protected TestDataFactory fixtures;
    protected TestDataFactory.Account admin;
    protected TestDataFactory.Account staff;

    @BeforeEach
    void initializeAccounts() throws Exception {
        fixtures = new TestDataFactory(mvc, json, jdbc);
        admin = fixtures.login(EMAIL, PASSWORD);
        staff = fixtures.staff(admin.token(), PASSWORD);
    }
}
