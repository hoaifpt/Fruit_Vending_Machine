package com.fruitmachine.backend.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.fruitmachine.backend.auth.dto.LoginRequest;
import com.fruitmachine.backend.auth.dto.LoginResponse;
import com.fruitmachine.backend.security.jwt.JwtService;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.enums.UserStatus;
import com.fruitmachine.backend.user.repository.UserRepository;
import com.fruitmachine.backend.user.repository.RoleRepository;
import io.swagger.v3.oas.annotations.Hidden;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.*;
import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"spring.config.import=", "springdoc.api-docs.enabled=true", "springdoc.swagger-ui.enabled=true"})
@AutoConfigureMockMvc
@Import(AuthIntegrationTest.ProtectedTestController.class)
@Testcontainers
@org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
class AuthIntegrationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18");
    static final String KEY = newKey();
    static String newKey() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-auth@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired UserRepository users;
    @Autowired RoleRepository roles;
    @Autowired PasswordEncoder encoder;
    @Autowired JdbcTemplate jdbc;
    @Autowired Flyway flyway;
    @Autowired JwtService tokens;

    User account(UserStatus status) {
        User user = new User();
        user.setEmail(UUID.randomUUID() + "@example.com");
        user.setPasswordHash(encoder.encode("Test-only-passphrase!"));
        user.setFullName("Isolated test account");
        user.setStatus(status);
        return users.saveAndFlush(user);
    }

    String login(User user) throws Exception {
        var result = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                        .content(mapper.writeValueAsString(new LoginRequest(user.getEmail().toUpperCase(), "Test-only-passphrase!"))))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.data.expiresIn").value(3600))
                .andExpect(content().string(not(containsString("Test-only-passphrase!"))))
                .andExpect(content().string(not(containsString(user.getPasswordHash()))))
                .andReturn();
        assertThat(result.getRequest().getSession(false)).isNull();
        return mapper.readTree(result.getResponse().getContentAsString()).at("/data/accessToken").asText();
    }

    @Test
    void bootstrappedAdminCanLoginAndUseJwtWithAdminAuthority(
            org.springframework.boot.test.system.CapturedOutput output) throws Exception {
        User admin = users.findWithRolesByEmail("bootstrap-auth@example.invalid").orElseThrow();
        var result = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                        .content(mapper.writeValueAsString(new LoginRequest(admin.getEmail(), "Test-only-bootstrap-passphrase!"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.tokenType").value("Bearer"))
                .andReturn();
        String token = mapper.readTree(result.getResponse().getContentAsString()).at("/data/accessToken").asText();
        assertThat(tokens.extractSubject(token)).isEqualTo(admin.getId());
        mvc.perform(get("/api/v1/test-only/principal").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(admin.getId().toString()))
                .andExpect(jsonPath("$.authorities[0]").value("ROLE_ADMIN"));
        assertThat(output.getAll()).doesNotContain("Test-only-bootstrap-passphrase!", admin.getPasswordHash(), token, KEY);
    }

    @Test
    void activeUserCanLoginAndAuthenticateProtectedRequestStatelesslyWithRoles(
            org.springframework.boot.test.system.CapturedOutput output) throws Exception {
        User user = account(UserStatus.ACTIVE);
        var role = roles.findByName("ADMIN").orElseThrow();
        jdbc.update("INSERT INTO user_roles(user_id, role_id) VALUES (?, ?)", user.getId(), role.getId());
        String token = login(user);
        assertThat(tokens.extractSubject(token)).isEqualTo(user.getId());
        mvc.perform(get("/api/v1/test-only/principal").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(user.getId().toString()))
                .andExpect(jsonPath("$.authorities[0]").value("ROLE_ADMIN"))
                .andExpect(header().doesNotExist("Set-Cookie"));
        mvc.perform(get("/api/v1/test-only/principal")).andExpect(status().isUnauthorized());
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        assertThat(output.getAll()).doesNotContain("Test-only-passphrase!", user.getPasswordHash(), token, KEY);
    }

    @Test
    void unknownEmailAndWrongPasswordHaveIdenticalGenericErrors() throws Exception {
        User user = account(UserStatus.ACTIVE);
        for (String email : new String[]{user.getEmail(), "unknown-" + UUID.randomUUID() + "@example.com"}) {
            mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                            .content(mapper.writeValueAsString(new LoginRequest(email, "wrong-password"))))
                    .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.status").value(401))
                    .andExpect(jsonPath("$.message").value("Invalid email or password"))
                    .andExpect(jsonPath("$.path").value("/api/v1/auth/login"))
                    .andExpect(content().string(not(containsString("wrong-password"))))
                    .andExpect(content().string(not(containsString(user.getPasswordHash()))));
        }
    }

    @ParameterizedTest
    @EnumSource(value = UserStatus.class, names = {"INACTIVE", "LOCKED"})
    void unavailableAccountsCannotLoginOrReusePreviouslyIssuedTokens(UserStatus status) throws Exception {
        User user = account(UserStatus.ACTIVE);
        String token = login(user);
        jdbc.update("UPDATE users SET status = ? WHERE id = ?", status.name(), user.getId());
        mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                        .content(mapper.writeValueAsString(new LoginRequest(user.getEmail(), "Test-only-passphrase!"))))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.message").value("Invalid email or password"));
        mvc.perform(get("/api/v1/test-only/principal").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"email\":\"\",\"password\":\"x\"}", "{\"email\":\"bad\",\"password\":\"x\"}",
            "{\"email\":\"test@example.com\",\"password\":\"\"}", "{}", "{", "null"})
    void rejectsInvalidOrMissingLoginFields(String body) throws Exception {
        mvc.perform(post("/api/v1/auth/login").contentType("application/json").content(body))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.status").value(400));
    }

    @Test
    void rejectsOversizedUtf8PasswordWithoutLeakingIt() throws Exception {
        String password = "ấ".repeat(30);
        mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                        .content(mapper.writeValueAsString(new LoginRequest("test@example.com", password))))
                .andExpect(status().isBadRequest()).andExpect(content().string(not(containsString(password))));
    }

    @Test
    void invalidExpiredWrongKeyAndDeletedUserTokensCannotAccessProtectedRoute() throws Exception {
        User user = account(UserStatus.ACTIVE);
        var principal = new AuthenticatedUser(user.getId(), user.getEmail(), user.getPasswordHash(), user.getStatus(), java.util.List.of());
        String expired = new JwtService(new com.fruitmachine.backend.security.jwt.JwtProperties(KEY, 1),
                Clock.offset(Clock.systemUTC(), Duration.ofSeconds(-10))).generateToken(principal);
        String otherKey = new JwtService(new com.fruitmachine.backend.security.jwt.JwtProperties(newKey(), 3600), Clock.systemUTC())
                .generateToken(principal);
        for (String token : new String[]{"a.b.c", expired, otherKey}) {
            mvc.perform(get("/api/v1/test-only/principal").header("Authorization", "Bearer " + token))
                    .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error").value("Unauthorized"));
        }
        String valid = login(user);
        users.deleteById(user.getId());
        mvc.perform(get("/api/v1/test-only/principal").header("Authorization", "Bearer " + valid))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void duplicateHeadersAreRejectedAndInfrastructureHealthRemainsPublic() throws Exception {
        mvc.perform(get("/api/v1/test-only/principal").header("Authorization", "Bearer a", "Bearer b"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
        mvc.perform(get("/actuator/env")).andExpect(status().isUnauthorized());
    }

    @Test
    void sensitiveDtosDoNotLeakThroughToString() {
        assertThat(new LoginRequest("email@example.com", "secret-password").toString()).doesNotContain("secret-password");
        assertThat(new LoginResponse("secret-token", "Bearer", 3600).toString()).doesNotContain("secret-token");
    }

    @Test
    void accessDeniedUsesCommon403WithoutExposingInternalDetails() throws Exception {
        String token = login(account(UserStatus.ACTIVE));
        mvc.perform(get("/api/v1/test-only/denied").header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.message").value("Access denied"))
                .andExpect(content().string(not(containsString("internal-policy-detail"))));
    }

    @Test
    void swaggerLoadsAndVersionControlledContractMatchesOperationsAndSchemas() throws Exception {
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
        String body = mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        var actual = mapper.readTree(body);
        var contract = new ObjectMapper(new YAMLFactory()).readTree(Path.of("../api-contract/api.yaml").toFile());
        assertThat(actual.path("info")).isEqualTo(contract.path("info"));
        assertThat(actual.path("tags")).isEqualTo(contract.path("tags"));
        assertThat(actual.at("/paths").fieldNames()).toIterable().containsExactlyInAnyOrder(
                "/api/v1/auth/login", "/api/v1/users", "/api/v1/users/{id}", "/api/v1/users/{id}/status",
                "/api/v1/products", "/api/v1/products/{id}", "/api/v1/products/{id}/status",
                "/api/v1/machines", "/api/v1/machines/{id}", "/api/v1/machines/{id}/status",
                "/api/v1/machines/{machineId}/slots", "/api/v1/machines/{machineId}/slots/{slotId}", "/api/v1/machines/{machineId}/slots/{slotId}/status",
                "/api/v1/product-batches", "/api/v1/product-batches/{id}");
        var operation = actual.at("/paths/~1api~1v1~1auth~1login/post");
        var expected = contract.at("/paths/~1api~1v1~1auth~1login/post");
        assertThat(operation.get("operationId")).isEqualTo(expected.get("operationId"));
        assertThat(operation.get("tags")).isEqualTo(expected.get("tags"));
        assertThat(operation.get("summary")).isEqualTo(expected.get("summary"));
        assertThat(operation.get("parameters")).isNull();
        assertThat(operation.at("/responses").fieldNames()).toIterable().containsExactlyInAnyOrder("200", "400", "401", "500");
        assertThat(actual.at("/components/securitySchemes/bearerAuth/type").asText()).isEqualTo("http");
        assertThat(actual.at("/components/securitySchemes/bearerAuth/scheme").asText()).isEqualTo("bearer");
        assertThat(operation.at("/requestBody/required").asBoolean()).isTrue();
        for (String schema : new String[]{"LoginRequest", "LoginResponse", "ApiErrorResponse", "ApiResponseLoginResponse"}) {
            assertThat(normalizeSchema(actual.at("/components/schemas/" + schema)))
                    .as("types, formats, refs, fields, required, enum, validation: %s", schema)
                    .isEqualTo(normalizeSchema(contract.at("/components/schemas/" + schema)));
        }
        for (String code : new String[]{"200", "400", "401", "500"}) {
            var response = operation.at("/responses/" + code);
            var expectedResponse = expected.at("/responses/" + code);
            assertThat(response.get("description")).isEqualTo(expectedResponse.get("description"));
            assertThat(response.get("content")).isEqualTo(expectedResponse.get("content"));
            assertThat(response.get("headers")).isEqualTo(expectedResponse.get("headers"));
        }
        assertThat(operation.get("requestBody")).isEqualTo(expected.get("requestBody"));
        assertThat(actual.at("/components/securitySchemes")).isEqualTo(contract.at("/components/securitySchemes"));
        assertThat(contract.path("openapi").asText()).isEqualTo("3.1.0");
        validateReferences(contract, contract);
        assertThat(actual.at("/components/schemas/LoginRequest/properties/email/maxLength").asInt()).isEqualTo(254);
        assertThat(actual.at("/components/schemas/LoginRequest/properties/password/maxLength").asInt()).isEqualTo(72);
        assertThat(actual.at("/components/schemas/LoginRequest/required")).isEqualTo(contract.at("/components/schemas/LoginRequest/required"));
        assertThat(operation.at("/security").isMissingNode() || operation.at("/security").isEmpty()).isTrue();
        assertThat(body).doesNotContain("passwordHash", KEY, "/test-only/");
    }

    private com.fasterxml.jackson.databind.JsonNode normalizeSchema(com.fasterxml.jackson.databind.JsonNode input) {
        if (input.isObject()) {
            var result = mapper.createObjectNode();
            input.fields().forEachRemaining(entry -> {
                if (!java.util.Set.of("description", "example").contains(entry.getKey())) {
                    if (entry.getKey().equals("required")) {
                        var required = mapper.createArrayNode();
                        java.util.stream.StreamSupport.stream(entry.getValue().spliterator(), false)
                                .map(com.fasterxml.jackson.databind.JsonNode::asText).sorted().forEach(required::add);
                        result.set("required", required);
                    } else {
                        result.set(entry.getKey(), normalizeSchema(entry.getValue()));
                    }
                }
            });
            return result;
        }
        return input;
    }

    private void validateReferences(com.fasterxml.jackson.databind.JsonNode root, com.fasterxml.jackson.databind.JsonNode node) {
        if (node.isObject() && node.has("$ref")) {
            String ref = node.path("$ref").asText();
            assertThat(ref).startsWith("#/");
            assertThat(root.at(ref.substring(1)).isMissingNode()).as("Resolved contract ref %s", ref).isFalse();
        }
        node.elements().forEachRemaining(child -> validateReferences(root, child));
    }

    @Hidden
    @RestController
    static class ProtectedTestController {
        @GetMapping("/api/v1/test-only/denied")
        void denied() {
            throw new org.springframework.security.access.AccessDeniedException("internal-policy-detail");
        }

        @GetMapping("/api/v1/test-only/principal")
        Map<String, Object> principal(Authentication authentication) {
            var user = (AuthenticatedUser) authentication.getPrincipal();
            return Map.of("id", user.getId(), "authorities", user.getAuthorities().stream().map(a -> a.getAuthority()).toList());
        }
    }
}
