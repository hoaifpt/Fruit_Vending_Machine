package com.fruitmachine.backend.maintenance;

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

/** Issue #64: Swagger and api-contract/api.yaml agree on the maintenance command APIs and the slot response. */
@SpringBootTest(properties = {"spring.config.import=", "app.payment.provider=MOCK", "springdoc.api-docs.enabled=true", "springdoc.swagger-ui.enabled=true"})
@AutoConfigureMockMvc(print = org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint.NONE)
@org.springframework.test.annotation.DirtiesContext(classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
@Testcontainers
class MaintenanceCommandDocumentationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = com.fruitmachine.backend.support.TestPostgres.create();
    static final String KEY = "dGVzdC1vbmx5LW1haW50ZW5hbmNlLWNvbW1hbmQtZG9jcy1qd3Qtc2VjcmV0LWtleSE=";
    static final List<String> PATHS = List.of("/api/v1/machines/{machineId}/slots/{slotId}/maintenance-commands",
            "/api/v1/machines/{machineId}/reset", "/api/v1/maintenance-commands", "/api/v1/maintenance-commands/{id}", "/api/v1/maintenance-commands/{id}/reconcile",
            "/api/v1/machines/{machineId}/slots/{slotId}");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-maintenance-docs@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @Test
    void swaggerAndContractAgreeOnMaintenanceCommands() throws Exception {
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
        var actual = mapper.readTree(mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        java.nio.file.Files.writeString(Path.of("target/maintenance-openapi.json"), mapper.writerWithDefaultPrettyPrinter().writeValueAsString(actual));
        var expected = new ObjectMapper(new YAMLFactory()).readTree(Path.of("../api-contract/api.yaml").toFile());

        assertThat(actual.path("tags")).isEqualTo(expected.path("tags"));
        assertThat(actual.path("tags").findValuesAsText("name")).contains("Maintenance Commands");
        assertThat(actual.path("paths").fieldNames()).toIterable().containsExactlyInAnyOrderElementsOf(() -> expected.path("paths").fieldNames());
        for (String path : PATHS) {
            assertThat(canonical(actual.path("paths").path(path))).as("operation %s", path).isEqualTo(canonical(expected.path("paths").path(path)));
        }
        List<String> schemas = new ArrayList<>();
        PATHS.forEach(path -> collect(actual, actual.path("paths").path(path), schemas));
        assertThat(schemas).contains("MaintenanceCommandResponse", "CreateMaintenanceCommandRequest", "ReconcileMaintenanceCommandRequest", "ResetMachineRequest",
                "MaintenanceCommandPageResponse", "MachineSlotResponse");
        for (String schema : schemas) {
            if (schema.equals("ApiErrorResponse")) continue;
            assertThat(canonical(actual.at("/components/schemas/" + schema))).as("schema %s", schema).isEqualTo(canonical(expected.at("/components/schemas/" + schema)));
        }
        var create = actual.at("/paths/~1api~1v1~1machines~1{machineId}~1slots~1{slotId}~1maintenance-commands/post");
        assertThat(create.path("x-required-permission").asText()).isEqualTo("MAINTENANCE_COMMAND_EXECUTE");
        assertThat(create.path("parameters").findValuesAsText("name")).contains("Idempotency-Key");
        assertThat(create.path("responses").fieldNames()).toIterable().contains("200", "201", "409");
        assertThat(actual.at("/paths/~1api~1v1~1machines~1{machineId}~1reset/post/x-required-permission").asText()).isEqualTo("MACHINE_RESET");
        assertThat(actual.at("/paths/~1api~1v1~1maintenance-commands/get/x-required-permission").asText()).isEqualTo("MAINTENANCE_COMMAND_READ");
        assertThat(actual.at("/paths/~1api~1v1~1maintenance-commands~1{id}~1reconcile/post/x-required-permission").asText()).isEqualTo("MAINTENANCE_COMMAND_EXECUTE");
        assertThat(actual.at("/components/schemas/MachineSlotResponse/properties").has("refillGateOpen")).isTrue();
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
