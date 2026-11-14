package com.fruitmachine.backend.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.fruitmachine.backend.security.permission.Permissions;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
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
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Issue #48: Swagger and api-contract/api.yaml agree on the role/permission APIs and on every operation's required permission. */
@SpringBootTest(properties = {"spring.config.import=", "app.payment.provider=MOCK", "springdoc.api-docs.enabled=true", "springdoc.swagger-ui.enabled=true"})
@AutoConfigureMockMvc(print = org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint.NONE)
@org.springframework.test.annotation.DirtiesContext(classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
@Testcontainers
class PermissionDocumentationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = com.fruitmachine.backend.support.TestPostgres.create();
    static final String KEY = "dGVzdC1vbmx5LXBlcm1pc3Npb24tZG9jcy1qd3Qtc2VjcmV0LWtleS0zMmIhIQ==";
    static final List<String> PATHS = List.of("/api/v1/permissions", "/api/v1/roles", "/api/v1/roles/{id}", "/api/v1/roles/{id}/permissions");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-permission-docs@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    Map<String, String> requiredPermissions(JsonNode spec) {
        Map<String, String> out = new TreeMap<>();
        spec.path("paths").fields().forEachRemaining(path -> path.getValue().fields().forEachRemaining(op -> {
            if (op.getValue().has("x-required-permission")) out.put(op.getKey().toUpperCase() + " " + path.getKey(), op.getValue().path("x-required-permission").asText());
        }));
        return out;
    }

    @Test
    void swaggerAndContractAgreeOnRolePermissionApisAndRequiredPermissions() throws Exception {
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
        var actual = mapper.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        var expected = new ObjectMapper(new YAMLFactory()).readTree(Path.of("../api-contract/api.yaml").toFile());

        assertThat(actual.path("tags")).isEqualTo(expected.path("tags"));
        assertThat(actual.path("tags").findValuesAsText("name")).contains("Roles & Permissions");
        assertThat(actual.path("paths").fieldNames()).toIterable().containsExactlyInAnyOrderElementsOf(() -> expected.path("paths").fieldNames());
        for (String path : PATHS) {
            assertThat(canonical(actual.path("paths").path(path))).as("operation %s", path).isEqualTo(canonical(expected.path("paths").path(path)));
        }
        List<String> schemas = new ArrayList<>();
        PATHS.forEach(path -> collect(actual, actual.path("paths").path(path), schemas));
        assertThat(schemas).contains("PermissionResponse", "RoleResponse", "ReplaceRolePermissionsRequest");
        for (String schema : schemas) {
            if (schema.equals("ApiErrorResponse")) continue;
            assertThat(canonical(actual.at("/components/schemas/" + schema))).as("schema %s", schema).isEqualTo(canonical(expected.at("/components/schemas/" + schema)));
        }

        // Every bearer operation states its permission, from the endpoint's own @PreAuthorize, identically in Swagger and the contract.
        Map<String, String> served = requiredPermissions(actual);
        assertThat(served).isEqualTo(requiredPermissions(expected));
        assertThat(served).hasSize(102);
        assertThat(served.values()).allMatch(Permissions.ALL::contains);
        assertThat(served).containsEntry("POST /api/v1/products", "PRODUCT_WRITE").containsEntry("GET /api/v1/products", "PRODUCT_READ")
                .containsEntry("POST /api/v1/inventory/load", "INVENTORY_LOAD_DIRECT").containsEntry("GET /api/v1/machines/{machineId}/inventory", "INVENTORY_READ")
                .containsEntry("PUT /api/v1/roles/{id}/permissions", "PERMISSION_MANAGE");
        actual.path("paths").fields().forEachRemaining(path -> path.getValue().fields().forEachRemaining(op -> {
            // Own notifications (#58) need a signed-in user only, so they carry no permission.
            boolean bearer = op.getValue().path("security").toString().contains("bearerAuth") && !path.getKey().startsWith("/api/v1/notifications");
            assertThat(op.getValue().has("x-required-permission")).as("%s %s", op.getKey(), path.getKey()).isEqualTo(bearer);
        }));

        var request = actual.at("/components/schemas/ReplaceRolePermissionsRequest");
        assertThat(request.path("additionalProperties").asBoolean(true)).isFalse();
        assertThat(request.at("/properties").fieldNames()).toIterable().containsExactly("permissions");
        assertThat(actual.at("/paths/~1api~1v1~1roles~1{id}~1permissions/put/responses").fieldNames()).toIterable().contains("200", "400", "401", "403", "404", "409");
        assertThat(actual.path("paths").fieldNames()).toIterable().noneMatch(p -> p.startsWith("/api/v1/roles") && !PATHS.contains(p));
        assertThat(actual.at("/paths/~1api~1v1~1roles").fieldNames()).toIterable().containsExactly("get");
    }

    private void collect(JsonNode root, JsonNode node, List<String> found) {
        if (node.isObject() && node.has("$ref")) {
            String name = node.path("$ref").asText().substring(node.path("$ref").asText().lastIndexOf('/') + 1);
            if (!found.contains(name)) {
                found.add(name);
                collect(root, root.at("/components/schemas/" + name), found);
            }
            return;
        }
        node.elements().forEachRemaining(child -> collect(root, child, found));
    }

    private JsonNode canonical(JsonNode input) {
        if (input.isNumber()) return mapper.getNodeFactory().numberNode(input.decimalValue());
        if (input.isObject()) {
            var result = mapper.createObjectNode();
            input.fields().forEachRemaining(entry -> {
                if (entry.getKey().equals("required")) {
                    var required = mapper.createArrayNode();
                    java.util.stream.StreamSupport.stream(entry.getValue().spliterator(), false).map(JsonNode::asText).sorted().forEach(required::add);
                    result.set("required", required);
                } else result.set(entry.getKey(), canonical(entry.getValue()));
            });
            return result;
        }
        if (input.isArray()) {
            var result = mapper.createArrayNode();
            input.forEach(child -> result.add(canonical(child)));
            return result;
        }
        return input;
    }
}
