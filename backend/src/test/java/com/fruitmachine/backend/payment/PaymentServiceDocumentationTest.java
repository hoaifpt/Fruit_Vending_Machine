package com.fruitmachine.backend.payment;

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
class PaymentServiceDocumentationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = com.fruitmachine.backend.support.TestPostgres.create();
    static final String KEY = "dGVzdC1vbmx5LXBheW1lbnQtZG9jcy1qd3Qtc2VjcmV0LWtleS0zMi1ieXRlcyEh";
    /** New payment operations plus the order operations whose responses were extended by this issue. */
    static final List<String> PATHS = List.of("/api/v1/kiosk/orders/{orderId}/payments", "/api/v1/payments", "/api/v1/payments/{id}",
            "/api/v1/kiosk/orders", "/api/v1/kiosk/orders/{orderId}", "/api/v1/kiosk/orders/{orderId}/cancel", "/api/v1/orders/{id}");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-payment-docs@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @Test
    void swaggerAndVersionedContractAgreeOnPaymentOperationsSchemasExamplesAndSecurity() throws Exception {
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
        var body = mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        var actual = mapper.readTree(body);
        Files.writeString(Path.of("target/payment-service-openapi.json"), mapper.writerWithDefaultPrettyPrinter().writeValueAsString(actual));
        var expected = new ObjectMapper(new YAMLFactory()).readTree(Path.of("../api-contract/api.yaml").toFile());

        assertThat(actual.path("info")).isEqualTo(expected.path("info"));
        assertThat(actual.path("tags")).isEqualTo(expected.path("tags"));
        assertThat(actual.path("tags").findValuesAsText("name")).contains("Kiosk Payments", "Payments");
        assertThat(actual.path("paths").fieldNames()).toIterable().containsExactlyInAnyOrderElementsOf(() -> expected.path("paths").fieldNames());
        for (String path : PATHS) {
            assertThat(actual.path("paths").has(path)).as("exposed %s", path).isTrue();
            assertThat(canonical(actual.path("paths").path(path))).as("complete operation %s", path).isEqualTo(canonical(expected.path("paths").path(path)));
        }
        List<String> schemas = new ArrayList<>();
        collectSchemaRefs(actual, actual.path("paths"), schemas);
        assertThat(schemas).contains("KioskPaymentResponse", "PaymentSummaryResponse", "PaymentResponse", "PaymentDetailResponse", "PaymentPageResponse",
                "KioskOrderResponse", "OrderDetailResponse");
        assertThat(actual.at("/components/schemas/ApiErrorResponse/properties").fieldNames()).toIterable()
                .containsExactlyInAnyOrderElementsOf(() -> expected.at("/components/schemas/ApiErrorResponse/properties").fieldNames());
        for (String schema : schemas) {
            if (schema.equals("ApiErrorResponse")) continue;
            assertThat(canonical(actual.at("/components/schemas/" + schema))).as("schema %s", schema).isEqualTo(canonical(expected.at("/components/schemas/" + schema)));
        }
        assertThat(canonical(actual.at("/components/securitySchemes"))).isEqualTo(canonical(expected.at("/components/securitySchemes")));

        var create = actual.at("/paths/~1api~1v1~1kiosk~1orders~1{orderId}~1payments/post");
        assertThat(create.path("security").get(0).has("kioskKey")).isTrue();
        assertThat(create.path("security").get(0).has("bearerAuth")).isFalse();
        assertThat(create.path("tags").get(0).asText()).isEqualTo("Kiosk Payments");
        assertThat(create.path("requestBody").isMissingNode()).isTrue();
        assertThat(create.path("responses").fieldNames()).toIterable().contains("200", "201", "404", "409", "502");
        assertThat(create.path("description").asText()).contains("2-3 seconds");
        for (String path : List.of("/api/v1/payments", "/api/v1/payments/{id}")) {
            assertThat(actual.at("/paths/" + path.replace("/", "~1")).fieldNames()).toIterable().containsExactly("get");
            assertThat(actual.at("/paths/" + path.replace("/", "~1") + "/get/security").get(0).has("bearerAuth")).isTrue();
            assertThat(actual.at("/paths/" + path.replace("/", "~1") + "/get/tags").get(0).asText()).isEqualTo("Payments");
        }
        assertThat(actual.at("/components/schemas/PaymentResponse/properties").has("qrCode")).isFalse();
        assertThat(actual.at("/components/schemas/PaymentDetailResponse/properties").has("qrCode")).isTrue();
        assertThat(actual.at("/components/schemas/PaymentSummaryResponse/properties").fieldNames()).toIterable()
                .containsExactlyInAnyOrder("id", "provider", "status", "amount", "createdAt", "paidAt", "expiredAt");
        assertThat(actual.at("/components/schemas/KioskOrderResponse/properties").has("currentPayment")).isTrue();
        assertThat(actual.at("/components/schemas/OrderDetailResponse/properties").has("payments")).isTrue();
        // No payment write, status or success operation and no webhook path is exposed.
        assertThat(actual.path("paths").fieldNames()).toIterable().noneMatch(path -> path.contains("webhook")
                || (path.startsWith("/api/v1/payments") && (path.contains("status") || path.contains("success"))));
        assertThat(body).doesNotContain(KEY, "passwordHash", "secretHash", "/test-only/");
    }

    private void collectSchemaRefs(JsonNode root, JsonNode node, List<String> found) {
        if (node == root.path("paths")) {
            PATHS.forEach(path -> collectSchemaRefs(root, node.path(path), found));
            return;
        }
        if (node.isObject() && node.has("$ref")) {
            String ref = node.path("$ref").asText();
            String name = ref.substring(ref.lastIndexOf('/') + 1);
            if (!found.contains(name)) {
                found.add(name);
                collectSchemaRefs(root, root.at("/components/schemas/" + name), found);
            }
            return;
        }
        node.elements().forEachRemaining(child -> collectSchemaRefs(root, child, found));
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
