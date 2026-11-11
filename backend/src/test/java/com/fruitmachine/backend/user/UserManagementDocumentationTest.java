package com.fruitmachine.backend.user;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {"spring.config.import=", "springdoc.api-docs.enabled=true", "springdoc.swagger-ui.enabled=true"})
@AutoConfigureMockMvc
@Testcontainers
class UserManagementDocumentationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18");
    static final String KEY = UserManagementIntegrationTest.newKey();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-user-docs@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @Test
    void swaggerAndContractAgreeOnAllUserOperationsAndSafeSchemas() throws Exception {
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
        mvc.perform(get("/v3/api-docs/swagger-config")).andExpect(status().isOk());
        String body = mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        var actual = mapper.readTree(body);
        Files.writeString(Path.of("target/user-management-openapi.json"), mapper.writerWithDefaultPrettyPrinter().writeValueAsString(actual));
        var expected = new ObjectMapper(new YAMLFactory()).readTree(Path.of("../api-contract/api.yaml").toFile());
        assertThat(actual.path("info")).isEqualTo(expected.path("info"));
        assertThat(actual.path("tags")).isEqualTo(expected.path("tags"));
        assertThat(actual.path("paths").fieldNames()).toIterable().containsExactlyInAnyOrderElementsOf(
                () -> expected.path("paths").fieldNames());
        for (String path : new String[]{"/api/v1/users", "/api/v1/users/{id}", "/api/v1/users/{id}/status"}) {
            var actualPath = actual.path("paths").path(path);
            var expectedPath = expected.path("paths").path(path);
            assertThat(actualPath.fieldNames()).toIterable().containsExactlyInAnyOrderElementsOf(() -> expectedPath.fieldNames());
            for (var fields = expectedPath.fields(); fields.hasNext();) {
                var method = fields.next();
                assertThat(actualPath.path(method.getKey())).as("operation, parameters, examples, responses, security: %s %s", method.getKey(), path)
                        .isEqualTo(method.getValue());
            }
        }
        for (String schema : new String[]{"CreateUserRequest", "UpdateUserRequest", "UpdateUserStatusRequest", "UserResponse",
                "UserPageResponse", "ApiResponseUserResponse", "ApiResponseUserPageResponse"}) {
            assertThat(normalize(actual.at("/components/schemas/" + schema))).as("schema %s", schema)
                    .isEqualTo(normalize(expected.at("/components/schemas/" + schema)));
        }
        validateReferences(expected, expected);
        assertThat(body).doesNotContain("passwordHash", KEY, "/test-only/");
        assertThat(actual.at("/components/schemas/UserResponse/properties").has("password")).isFalse();
        assertThat(actual.at("/components/schemas/CreateUserRequest/properties/password/writeOnly").asBoolean()).isTrue();
    }

    private JsonNode normalize(JsonNode input) {
        if (input.isObject()) {
            var result = mapper.createObjectNode();
            input.fields().forEachRemaining(entry -> {
                if (!Set.of("description", "example").contains(entry.getKey())) {
                    if (entry.getKey().equals("required")) {
                        var required = mapper.createArrayNode();
                        java.util.stream.StreamSupport.stream(entry.getValue().spliterator(), false)
                                .map(JsonNode::asText).sorted().forEach(required::add);
                        result.set("required", required);
                    } else result.set(entry.getKey(), normalize(entry.getValue()));
                }
            });
            return result;
        }
        if (input.isArray()) {
            var result = mapper.createArrayNode();
            input.forEach(child -> result.add(normalize(child)));
            return result;
        }
        return input;
    }

    private void validateReferences(JsonNode root, JsonNode node) {
        if (node.isObject() && node.has("$ref")) {
            String ref = node.path("$ref").asText();
            assertThat(ref).startsWith("#/");
            assertThat(root.at(ref.substring(1)).isMissingNode()).as("resolved contract ref %s", ref).isFalse();
        }
        node.elements().forEachRemaining(child -> validateReferences(root, child));
    }
}
