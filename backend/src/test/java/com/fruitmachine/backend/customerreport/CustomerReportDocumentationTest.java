package com.fruitmachine.backend.customerreport;

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

/** Issue #74: Swagger and api-contract/api.yaml agree on the public report, customer report, kiosk link and token rotation APIs. */
@SpringBootTest(properties = {"spring.config.import=", "app.payment.provider=MOCK", "springdoc.api-docs.enabled=true", "springdoc.swagger-ui.enabled=true"})
@AutoConfigureMockMvc(print = org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint.NONE)
@org.springframework.test.annotation.DirtiesContext(classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
@Testcontainers
class CustomerReportDocumentationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = com.fruitmachine.backend.support.TestPostgres.create();
    static final String KEY = "dGVzdC1vbmx5LWN1c3RvbWVyLXJlcG9ydC1kb2NzLWp3dC1zZWNyZXQta2V5LTc0IQ==";
    static final List<String> PATHS = List.of("/api/v1/public/report-forms/{reportToken}", "/api/v1/public/report-forms/{reportToken}/reports",
            "/api/v1/kiosk/incident-report-link", "/api/v1/customer-reports", "/api/v1/customer-reports/{id}",
            "/api/v1/customer-reports/{id}/photos/{photoId}", "/api/v1/customer-reports/{id}/review", "/api/v1/customer-reports/{id}/resolve",
            "/api/v1/customer-reports/{id}/reject", "/api/v1/machines/{id}/report-token/rotate", "/api/v1/refunds/candidates",
            "/api/v1/work-orders/{id}", "/api/v1/work-orders");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-report-docs@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @Test
    void swaggerAndContractAgreeOnCustomerReports() throws Exception {
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
        var actual = mapper.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        java.nio.file.Files.writeString(Path.of("target/report-openapi.json"), mapper.writerWithDefaultPrettyPrinter().writeValueAsString(actual));
        var expected = new ObjectMapper(new YAMLFactory()).readTree(Path.of("../api-contract/api.yaml").toFile());

        assertThat(actual.path("tags")).isEqualTo(expected.path("tags"));
        assertThat(actual.path("tags").findValuesAsText("name")).contains("Public Reports", "Customer Reports");
        assertThat(actual.path("paths").fieldNames()).toIterable().containsExactlyInAnyOrderElementsOf(() -> expected.path("paths").fieldNames());
        for (String path : PATHS) {
            assertThat(canonical(actual.path("paths").path(path))).as("operation %s", path).isEqualTo(canonical(expected.path("paths").path(path)));
        }
        List<String> schemas = new ArrayList<>();
        PATHS.forEach(path -> collect(actual, actual.path("paths").path(path), schemas));
        assertThat(schemas).contains("PublicReportRequest", "ReportSubmittedResponse", "ReportFormResponse", "CustomerReportDetailResponse",
                "CustomerReportPageResponse", "ReportDecisionRequest", "ReportLinkResponse", "RefundCandidateReportResponse", "WorkOrderLinkedReport");
        for (String schema : schemas) {
            if (schema.equals("ApiErrorResponse")) continue;
            assertThat(canonical(actual.at("/components/schemas/" + schema))).as("schema %s", schema).isEqualTo(canonical(expected.at("/components/schemas/" + schema)));
        }
        assertThat(actual.at("/paths/~1api~1v1~1public~1report-forms~1{reportToken}~1reports/post/security").isArray()).isTrue();
        assertThat(actual.at("/paths/~1api~1v1~1public~1report-forms~1{reportToken}~1reports/post/security")).isEmpty();
        assertThat(actual.at("/paths/~1api~1v1~1public~1report-forms~1{reportToken}~1reports/post/requestBody/content").has("multipart/form-data")).isTrue();
        assertThat(actual.at("/paths/~1api~1v1~1public~1report-forms~1{reportToken}~1reports/post/responses").has("429")).isTrue();
        assertThat(actual.at("/paths/~1api~1v1~1customer-reports/get/x-required-permission").asText()).isEqualTo("CUSTOMER_REPORT_READ");
        assertThat(actual.at("/paths/~1api~1v1~1customer-reports~1{id}~1resolve/post/x-required-permission").asText()).isEqualTo("CUSTOMER_REPORT_MANAGE");
        assertThat(actual.at("/paths/~1api~1v1~1machines~1{id}~1report-token~1rotate/post/x-required-permission").asText()).isEqualTo("MACHINE_REPORT_LINK_MANAGE");
        assertThat(actual.at("/components/schemas/PublicReportRequest/additionalProperties").asBoolean(true)).isFalse();
        assertThat(actual.at("/components/schemas/WorkOrderResponse/properties").has("linkedReports")).isTrue();
        assertThat(actual.at("/components/schemas/RefundCandidateResponse/properties").has("customerReport")).isTrue();
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
