package com.fruitmachine.backend.pricing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
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

/** Issue #61: Swagger and api-contract/api.yaml agree on the pricing API and the changed order, catalog and inventory schemas. */
@SpringBootTest(properties = {"spring.config.import=", "app.payment.provider=MOCK", "springdoc.api-docs.enabled=true", "springdoc.swagger-ui.enabled=true"})
@AutoConfigureMockMvc(print = org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint.NONE)
@org.springframework.test.annotation.DirtiesContext(classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
@Testcontainers
class NearExpiryPricingDocumentationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = com.fruitmachine.backend.support.TestPostgres.create();
    static final String KEY = "dGVzdC1vbmx5LW5lYXItZXhwaXJ5LXByaWNpbmctZG9jcy1qd3Qtc2VjcmV0LWtleSE=";
    static final List<String> PATHS = List.of("/api/v1/pricing/near-expiry-discount", "/api/v1/kiosk/catalog", "/api/v1/kiosk/orders",
            "/api/v1/kiosk/orders/{id}", "/api/v1/orders", "/api/v1/orders/{id}", "/api/v1/inventory", "/api/v1/machines/{machineId}/inventory");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-pricing-docs@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @Test
    void swaggerAndContractAgreeOnPricingAndTheDiscountFields() throws Exception {
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
        var actual = mapper.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        java.nio.file.Files.writeString(Path.of("target/pricing-openapi.json"), mapper.writerWithDefaultPrettyPrinter().writeValueAsString(actual));
        var expected = new ObjectMapper(new YAMLFactory()).readTree(Path.of("../api-contract/api.yaml").toFile());

        assertThat(actual.path("tags")).isEqualTo(expected.path("tags"));
        assertThat(actual.path("tags").findValuesAsText("name")).contains("Pricing");
        assertThat(actual.path("paths").fieldNames()).toIterable().containsExactlyInAnyOrderElementsOf(() -> expected.path("paths").fieldNames());
        for (String path : PATHS) {
            assertThat(canonical(actual.path("paths").path(path))).as("operation %s", path).isEqualTo(canonical(expected.path("paths").path(path)));
        }
        List<String> schemas = new ArrayList<>();
        PATHS.forEach(path -> collect(actual, actual.path("paths").path(path), schemas));
        assertThat(schemas).contains("NearExpiryDiscountResponse", "UpdateNearExpiryDiscountRequest", "KioskCatalogProductResponse", "KioskOrderItemResponse",
                "OrderItemDetailResponse", "OrderSummaryResponse", "InventoryItemResponse");
        for (String schema : schemas) {
            if (schema.equals("ApiErrorResponse")) continue;
            assertThat(canonical(actual.at("/components/schemas/" + schema))).as("schema %s", schema).isEqualTo(canonical(expected.at("/components/schemas/" + schema)));
        }
        var setting = actual.at("/paths/~1api~1v1~1pricing~1near-expiry-discount");
        assertThat(setting.fieldNames()).toIterable().containsExactlyInAnyOrder("get", "put");
        assertThat(setting.at("/get/x-required-permission").asText()).isEqualTo("PRICING_READ");
        assertThat(setting.at("/put/x-required-permission").asText()).isEqualTo("PRICING_MANAGE");
        assertThat(setting.at("/get/tags/0").asText()).isEqualTo("Pricing");
        assertThat(actual.at("/components/schemas/KioskCatalogProductResponse/properties").fieldNames()).toIterable()
                .contains("price", "originalPrice", "discountPercent", "discountReason");
        assertThat(actual.at("/components/schemas/KioskOrderResponse/properties").has("discountAmount")).isTrue();
        assertThat(actual.at("/components/schemas/OrderDetailResponse/properties").has("discountAmount")).isTrue();
        assertThat(actual.at("/components/schemas/InventoryItemResponse/properties").has("discountEligibleToday")).isTrue();
        assertThat(actual.at("/paths/~1api~1v1~1orders/get/parameters").findValuesAsText("name")).contains("discounted");
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
