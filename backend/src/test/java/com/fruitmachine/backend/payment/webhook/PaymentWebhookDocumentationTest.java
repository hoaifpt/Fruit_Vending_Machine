package com.fruitmachine.backend.payment.webhook;

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

@SpringBootTest(properties = {"spring.config.import=", "app.payment.provider=MOCK", "springdoc.api-docs.enabled=true", "springdoc.swagger-ui.enabled=true"})
@AutoConfigureMockMvc(print = org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint.NONE)
@org.springframework.test.annotation.DirtiesContext(classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
@Testcontainers
class PaymentWebhookDocumentationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = com.fruitmachine.backend.support.TestPostgres.create();
    static final String KEY = "dGVzdC1vbmx5LXdlYmhvb2stZG9jcy1qd3Qtc2VjcmV0LWtleS0zMi1ieXRlcyE=";
    /** New operations plus the payments list whose filter was extended. */
    static final List<String> PATHS = List.of("/api/v1/webhooks/payments/{provider}", "/api/v1/payment-webhook-logs",
            "/api/v1/payment-webhook-logs/{id}", "/api/v1/payments");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-webhook-docs@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @Test
    void swaggerAndVersionedContractAgreeOnWebhookOperationsSchemasExamplesAndSecurity() throws Exception {
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
        var body = mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        var actual = mapper.readTree(body);
        Files.writeString(Path.of("target/payment-webhook-openapi.json"), mapper.writerWithDefaultPrettyPrinter().writeValueAsString(actual));
        var expected = new ObjectMapper(new YAMLFactory()).readTree(Path.of("../api-contract/api.yaml").toFile());

        assertThat(actual.path("info")).isEqualTo(expected.path("info"));
        assertThat(actual.path("tags")).isEqualTo(expected.path("tags"));
        assertThat(actual.path("tags").findValuesAsText("name")).contains("Payment Webhooks", "Payment Webhook Logs");
        assertThat(actual.path("paths").fieldNames()).toIterable().containsExactlyInAnyOrderElementsOf(() -> expected.path("paths").fieldNames());
        for (String path : PATHS) {
            assertThat(actual.path("paths").has(path)).as("exposed %s", path).isTrue();
            assertThat(canonical(actual.path("paths").path(path))).as("complete operation %s", path).isEqualTo(canonical(expected.path("paths").path(path)));
        }
        List<String> schemas = new ArrayList<>();
        collectSchemaRefs(actual, actual.path("paths"), schemas);
        assertThat(schemas).contains("PaymentWebhookLogSummaryResponse", "PaymentWebhookLogDetailResponse", "PaymentWebhookLogPageResponse");
        assertThat(actual.at("/components/schemas/ApiErrorResponse/properties").fieldNames()).toIterable()
                .containsExactlyInAnyOrderElementsOf(() -> expected.at("/components/schemas/ApiErrorResponse/properties").fieldNames());
        for (String schema : schemas) {
            if (schema.equals("ApiErrorResponse")) continue;
            assertThat(canonical(actual.at("/components/schemas/" + schema))).as("schema %s", schema).isEqualTo(canonical(expected.at("/components/schemas/" + schema)));
        }
        assertThat(canonical(actual.at("/components/securitySchemes"))).isEqualTo(canonical(expected.at("/components/securitySchemes")));

        // The webhook is public and signature-based: no JWT or kiosk-key requirement, documented explicitly.
        var webhook = actual.at("/paths/~1api~1v1~1webhooks~1payments~1{provider}/post");
        assertThat(actual.at("/paths/~1api~1v1~1webhooks~1payments~1{provider}").fieldNames()).toIterable().containsExactly("post");
        assertThat(webhook.path("security").isArray()).isTrue();
        assertThat(webhook.path("security")).isEmpty();
        assertThat(webhook.path("tags").get(0).asText()).isEqualTo("Payment Webhooks");
        assertThat(webhook.path("responses").fieldNames()).toIterable().contains("200", "401", "404", "413", "415", "500");
        assertThat(webhook.path("description").asText()).contains("signature", "64 KB", "idempotently");
        assertThat(body).doesNotContain(KEY, "secretHash", "/test-only/");

        for (String path : List.of("/api/v1/payment-webhook-logs", "/api/v1/payment-webhook-logs/{id}")) {
            var operation = actual.at("/paths/" + path.replace("/", "~1") + "/get");
            assertThat(actual.at("/paths/" + path.replace("/", "~1")).fieldNames()).toIterable().containsExactly("get");
            assertThat(operation.path("security").get(0).has("bearerAuth")).isTrue();
            assertThat(operation.path("tags").get(0).asText()).isEqualTo("Payment Webhook Logs");
        }
        assertThat(actual.at("/components/schemas/PaymentWebhookLogSummaryResponse/properties").fieldNames()).toIterable()
                .containsExactlyInAnyOrder("id", "provider", "eventType", "reference", "verified", "receivedAt");
        assertThat(actual.at("/components/schemas/PaymentWebhookLogDetailResponse/properties").has("signature")).isFalse();
        assertThat(actual.at("/components/schemas/PaymentWebhookLogSummaryResponse/properties").has("signature")).isFalse();
        var parameters = actual.at("/paths/~1api~1v1~1payments/get/parameters");
        assertThat(parameters.findValuesAsText("name")).contains("requiresAttention");
        // No replay, mark-paid or delete operation exists for webhooks or payments.
        assertThat(actual.path("paths").fieldNames()).toIterable().noneMatch(path -> path.contains("replay") || path.contains("mark-paid"));
        assertThat(actual.at("/paths/~1api~1v1~1payment-webhook-logs~1{id}").has("delete")).isFalse();
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
