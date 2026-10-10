package com.fruitmachine.backend.inventory;

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
@AutoConfigureMockMvc(print = org.springframework.boot.test.autoconfigure.web.servlet.MockMvcPrint.NONE)
@org.springframework.test.annotation.DirtiesContext(classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
@Testcontainers
class InventoryManagementDocumentationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = com.fruitmachine.backend.support.TestPostgres.create();
    static final String KEY = InventoryManagementIntegrationTest.KEY;
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-inventory-docs@example.invalid");
        registry.add("app.bootstrap.admin.password", () -> "Test-only-bootstrap-passphrase!");
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    @Test
    void swaggerAndVersionedContractAgreeOnOperationsSchemasExamplesAndSecurity() throws Exception {
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
        mvc.perform(get("/v3/api-docs/swagger-config")).andExpect(status().isOk());
        var body = mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        var actual = mapper.readTree(body);
        Files.writeString(Path.of("target/inventory-management-openapi.json"), mapper.writerWithDefaultPrettyPrinter().writeValueAsString(actual));
        var expected = new ObjectMapper(new YAMLFactory()).readTree(Path.of("../api-contract/api.yaml").toFile());
        assertThat(actual.path("info")).isEqualTo(expected.path("info"));
        assertThat(actual.path("tags")).isEqualTo(expected.path("tags"));
        assertThat(actual.path("paths").fieldNames()).toIterable().containsExactlyInAnyOrderElementsOf(() -> expected.path("paths").fieldNames());
        for (String path : new String[]{"/api/v1/inventory", "/api/v1/inventory/{id}", "/api/v1/inventory/load", "/api/v1/inventory/{id}/remove", "/api/v1/inventory/transactions", "/api/v1/machines/{machineId}/inventory", "/api/v1/machines/{machineId}/slots/{slotId}/inventory", "/api/v1/machines/{machineId}/slots/{slotId}/inventory/summary"})
            assertThat(canonical(actual.path("paths").path(path))).as("complete inventory operation %s",path).isEqualTo(canonical(expected.path("paths").path(path)));
        for (String schema : new String[]{"LoadInventoryRequest","RemoveInventoryRequest","InventoryItemResponse","InventoryLoadResponse","InventorySummaryResponse","InventoryPageResponse","InventoryTransactionResponse","InventoryTransactionPageResponse","ApiResponseInventoryItemResponse","ApiResponseInventoryLoadResponse","ApiResponseInventoryPageResponse","ApiResponseInventorySummaryResponse","ApiResponseInventoryTransactionPageResponse"})
            assertThat(canonical(actual.at("/components/schemas/"+schema))).as("schema %s",schema).isEqualTo(canonical(expected.at("/components/schemas/"+schema)));
        var load=actual.at("/components/schemas/LoadInventoryRequest");
        assertThat(load.path("additionalProperties").asBoolean(true)).isFalse(); assertThat(load.path("required")).hasSize(3);
        assertThat(load.at("/properties/quantity/minimum").asInt()).isEqualTo(1); assertThat(load.at("/properties/quantity/maximum").asInt()).isEqualTo(1000);
        assertThat(actual.at("/components/schemas/RemoveInventoryRequest/properties/reason/maxLength").asInt()).isEqualTo(500);
        assertThat(actual.at("/components/schemas/InventoryTransactionResponse/properties").fieldNames()).toIterable().containsExactlyInAnyOrder("id","inventoryItemId","batchId","batchCode","machineId","slotId","type","referenceId","performedBy","reason","statusBefore","statusAfter","createdAt");
        assertThat(actual.at("/components/schemas/InventorySummaryResponse/properties").fieldNames()).toIterable().containsExactlyInAnyOrder("machineId","slotId","capacity","occupiedCount","availableCount","expiredCount","reservedCount","sellableCount","remainingCapacity","asOf");
        assertThat(actual.at("/paths/~1api~1v1~1inventory~1{id}").fieldNames()).toIterable().containsExactly("get");
        validateReferences(expected, expected);
        assertThat(body).doesNotContain(KEY, "passwordHash", "/test-only/");
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
    private void validateReferences(JsonNode root, JsonNode node) {
        if (node.isObject() && node.has("$ref")) {
            String ref = node.path("$ref").asText();
            assertThat(ref).startsWith("#/");
            assertThat(root.at(ref.substring(1)).isMissingNode()).as("resolved ref %s", ref).isFalse();
        }
        node.elements().forEachRemaining(child -> validateReferences(root, child));
    }
}
