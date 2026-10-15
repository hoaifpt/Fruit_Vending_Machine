package com.fruitmachine.backend.order;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
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

@SpringBootTest(properties = {"spring.config.import=", "springdoc.api-docs.enabled=true", "springdoc.swagger-ui.enabled=true"})
@AutoConfigureMockMvc(print = org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint.NONE)
@org.springframework.test.annotation.DirtiesContext(classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
@Testcontainers
class OrderManagementDocumentationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = com.fruitmachine.backend.support.TestPostgres.create();
    static final String KEY = "dGVzdC1vbmx5LW9yZGVyLWRvY3Mtand0LXNlY3JldC1rZXktMzItYnl0ZXMhIQ==";
    static final List<String> PATHS = List.of("/api/v1/machines/{machineId}/kiosk-credentials",
            "/api/v1/machines/{machineId}/kiosk-credentials/{credentialId}/revoke", "/api/v1/kiosk/me", "/api/v1/kiosk/catalog",
            "/api/v1/kiosk/orders", "/api/v1/kiosk/orders/{orderId}", "/api/v1/kiosk/orders/{orderId}/cancel", "/api/v1/orders",
            "/api/v1/orders/{id}");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-order-docs@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @Test
    void swaggerAndVersionedContractAgreeOnOrderManagementOperationsSchemasExamplesAndSecurity() throws Exception {
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
        mvc.perform(get("/v3/api-docs/swagger-config")).andExpect(status().isOk());
        var body = mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        var actual = mapper.readTree(body);
        Files.writeString(Path.of("target/order-management-openapi.json"), mapper.writerWithDefaultPrettyPrinter().writeValueAsString(actual));
        var expected = new ObjectMapper(new YAMLFactory()).readTree(Path.of("../api-contract/api.yaml").toFile());

        assertThat(actual.path("info")).isEqualTo(expected.path("info"));
        assertThat(actual.path("tags")).isEqualTo(expected.path("tags"));
        assertThat(actual.path("tags").findValuesAsText("name")).contains("Kiosk", "Kiosk Credentials", "Kiosk Orders", "Orders");
        assertThat(actual.path("paths").fieldNames()).toIterable().containsExactlyInAnyOrderElementsOf(() -> expected.path("paths").fieldNames());
        for (String path : PATHS) {
            assertThat(actual.path("paths").has(path)).as("exposed %s", path).isTrue();
            assertThat(canonical(actual.path("paths").path(path))).as("complete operation %s", path).isEqualTo(canonical(expected.path("paths").path(path)));
        }
        List<String> schemas = new ArrayList<>();
        collectSchemaRefs(actual, actual.path("paths"), PATHS, schemas);
        assertThat(schemas).contains("CreateOrderRequest", "CreateOrderItemRequest", "KioskOrderResponse", "OrderDetailResponse", "OrderPageResponse",
                "KioskCatalogResponse", "IssuedKioskCredentialResponse", "KioskCredentialResponse", "KioskIdentityResponse");
        // The shared error schema predates this issue and is hand-documented; only its property names are compared.
        assertThat(actual.at("/components/schemas/ApiErrorResponse/properties").fieldNames()).toIterable()
                .containsExactlyInAnyOrderElementsOf(() -> expected.at("/components/schemas/ApiErrorResponse/properties").fieldNames());
        for (String schema : schemas) {
            if (schema.equals("ApiErrorResponse")) continue;
            assertThat(canonical(actual.at("/components/schemas/" + schema))).as("schema %s", schema).isEqualTo(canonical(expected.at("/components/schemas/" + schema)));
        }
        assertThat(canonical(actual.at("/components/securitySchemes"))).isEqualTo(canonical(expected.at("/components/securitySchemes")));
        assertThat(actual.at("/components/securitySchemes/kioskKey/name").asText()).isEqualTo("X-Kiosk-Key");
        assertThat(actual.at("/components/securitySchemes/kioskKey/in").asText()).isEqualTo("header");

        for (String path : PATHS) {
            boolean kiosk = path.startsWith("/api/v1/kiosk");
            actual.path("paths").path(path).fields().forEachRemaining(method -> {
                var security = method.getValue().path("security");
                assertThat(security).as("%s %s security", method.getKey(), path).hasSize(1);
                assertThat(security.get(0).has(kiosk ? "kioskKey" : "bearerAuth")).isTrue();
                assertThat(security.get(0).has(kiosk ? "bearerAuth" : "kioskKey")).isFalse();
                assertThat(method.getValue().path("operationId").asText()).isNotBlank();
                assertThat(method.getValue().path("summary").asText()).isNotBlank();
            });
        }
        var create = actual.at("/components/schemas/CreateOrderRequest");
        assertThat(create.path("additionalProperties").asBoolean(true)).isFalse();
        assertThat(create.at("/properties").fieldNames()).toIterable().containsExactly("items");
        assertThat(actual.at("/components/schemas/CreateOrderItemRequest/properties").fieldNames()).toIterable().containsExactlyInAnyOrder("productId", "quantity");
        assertThat(actual.at("/components/schemas/CreateOrderItemRequest/properties/quantity/minimum").asInt()).isEqualTo(1);
        assertThat(actual.at("/components/schemas/KioskCredentialResponse/properties").fieldNames()).toIterable()
                .containsExactlyInAnyOrder("credentialId", "keyPrefix", "status", "createdAt", "createdBy", "revokedAt", "revokedBy");
        // The management Orders API is read-only; no write or status operation is exposed.
        assertThat(actual.path("paths").path("/api/v1/orders").fieldNames()).toIterable().containsExactly("get");
        assertThat(actual.path("paths").path("/api/v1/orders/{id}").fieldNames()).toIterable().containsExactly("get");
        assertThat(actual.path("paths").fieldNames()).toIterable().noneMatch(path -> path.startsWith("/api/v1/orders") && path.contains("status"));
        assertThat(body).doesNotContain(KEY, "passwordHash", "secretHash", "secret_hash", "/test-only/");
    }

    private void collectSchemaRefs(JsonNode root, JsonNode node, List<String> paths, List<String> found) {
        if (node == root.path("paths")) {
            paths.forEach(path -> collectSchemaRefs(root, node.path(path), paths, found));
            return;
        }
        if (node.isObject() && node.has("$ref")) {
            String ref = node.path("$ref").asText();
            String name = ref.substring(ref.lastIndexOf('/') + 1);
            if (!found.contains(name)) {
                found.add(name);
                collectSchemaRefs(root, root.at("/components/schemas/" + name), paths, found);
            }
            return;
        }
        node.elements().forEachRemaining(child -> collectSchemaRefs(root, child, paths, found));
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
