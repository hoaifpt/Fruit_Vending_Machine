package com.fruitmachine.backend.product;

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
@org.springframework.test.annotation.DirtiesContext(classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
@Testcontainers
class ProductManagementDocumentationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = com.fruitmachine.backend.support.TestPostgres.create();
    static final String KEY = ProductManagementIntegrationTest.newKey();
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-product-docs@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @Test
    void swaggerAndContractAgreeOnProductOperationsSchemasValidationAndExamples() throws Exception {
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
        mvc.perform(get("/v3/api-docs/swagger-config")).andExpect(status().isOk());
        String body = mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        var actual = mapper.readTree(body);
        Files.writeString(Path.of("target/product-management-openapi.json"), mapper.writerWithDefaultPrettyPrinter().writeValueAsString(actual));
        var expected = new ObjectMapper(new YAMLFactory()).readTree(Path.of("../api-contract/api.yaml").toFile());
        assertThat(actual.path("info")).isEqualTo(expected.path("info"));
        assertThat(actual.path("tags")).isEqualTo(expected.path("tags"));
        assertThat(actual.path("paths").fieldNames()).toIterable().containsExactlyInAnyOrderElementsOf(() -> expected.path("paths").fieldNames());
        for (String path : new String[]{"/api/v1/products", "/api/v1/products/{id}", "/api/v1/products/{id}/status"}) {
            assertThat(canonicalNumbers(actual.path("paths").path(path))).as("complete product operations %s", path)
                    .isEqualTo(canonicalNumbers(expected.path("paths").path(path)));
        }
        for (String schema : new String[]{"CreateProductRequest", "UpdateProductRequest", "UpdateProductStatusRequest", "ProductResponse",
                "ProductPageResponse", "ApiResponseProductResponse", "ApiResponseProductPageResponse"}) {
            assertThat(normalize(actual.at("/components/schemas/" + schema))).as("schema %s", schema)
                    .isEqualTo(normalize(expected.at("/components/schemas/" + schema)));
        }
        var create = actual.at("/components/schemas/CreateProductRequest");
        assertThat(create.path("additionalProperties").asBoolean(true)).isFalse();
        assertThat(create.path("required")).contains(mapper.getNodeFactory().textNode("sku"), mapper.getNodeFactory().textNode("name"),
                mapper.getNodeFactory().textNode("price"));
        assertThat(create.at("/properties/sku/maxLength").asInt()).isEqualTo(64);
        assertThat(create.at("/properties/name/maxLength").asInt()).isEqualTo(200);
        assertThat(create.at("/properties/imageUrl/maxLength").asInt()).isEqualTo(2048);
        assertThat(create.at("/properties/price/type").asText()).isEqualTo("number");
        assertThat(create.at("/properties/price/maximum").decimalValue()).isEqualByComparingTo("9999999999.99");
        assertThat(create.at("/properties/price/exclusiveMinimum").decimalValue()).isEqualByComparingTo("0");
        assertThat(create.at("/properties/price/multipleOf").decimalValue()).isEqualByComparingTo("0.01");
        assertThat(create.at("/properties/price/description").asText()).contains("two decimal places");
        assertThat(actual.at("/components/schemas/UpdateProductRequest/properties").has("sku")).isFalse();
        assertThat(actual.at("/components/schemas/UpdateProductRequest/properties").has("status")).isFalse();
        assertThat(actual.at("/components/schemas/ProductResponse/properties").fieldNames()).toIterable()
                .containsExactlyInAnyOrder("id", "sku", "name", "description", "price", "imageUrl", "status", "createdAt", "updatedAt");
        assertThat(actual.at("/components/schemas/UpdateProductStatusRequest/properties/status/enum")).contains(
                mapper.getNodeFactory().textNode("ACTIVE"), mapper.getNodeFactory().textNode("INACTIVE"));
        validateReferences(expected, expected);
        assertThat(body).doesNotContain(KEY, "passwordHash", "/test-only/");
    }

    private JsonNode normalize(JsonNode input) {
        if (input.isNumber()) return mapper.getNodeFactory().numberNode(input.decimalValue());
        if (input.isObject()) {
            var result = mapper.createObjectNode();
            input.fields().forEachRemaining(entry -> {
                if (!Set.of("description", "example").contains(entry.getKey())) {
                    if (entry.getKey().equals("required")) {
                        var required = mapper.createArrayNode();
                        java.util.stream.StreamSupport.stream(entry.getValue().spliterator(), false).map(JsonNode::asText).sorted().forEach(required::add);
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
            assertThat(root.at(ref.substring(1)).isMissingNode()).as("resolved ref %s", ref).isFalse();
        }
        node.elements().forEachRemaining(child -> validateReferences(root, child));
    }

    private JsonNode canonicalNumbers(JsonNode input) {
        // YAML may parse 35000 as an integer, JSON as 35000.0; compare numeric meaning, not parser node class.
        if (input.isNumber()) return mapper.getNodeFactory().numberNode(input.decimalValue());
        if (input.isObject()) {
            var result = mapper.createObjectNode();
            input.fields().forEachRemaining(entry -> result.set(entry.getKey(), canonicalNumbers(entry.getValue())));
            return result;
        }
        if (input.isArray()) {
            var result = mapper.createArrayNode();
            input.forEach(child -> result.add(canonicalNumbers(child)));
            return result;
        }
        return input;
    }
}
