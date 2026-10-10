package com.fruitmachine.backend.machine;

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
class MachineSlotManagementDocumentationTest {
    @Container static final PostgreSQLContainer<?> POSTGRES = com.fruitmachine.backend.support.TestPostgres.create();
    static final String KEY = MachineSlotManagementIntegrationTest.KEY;
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("security.jwt.secret", () -> KEY);
        registry.add("app.bootstrap.admin.email", () -> "bootstrap-slot-docs@example.invalid");
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
        Files.writeString(Path.of("target/machine-slot-management-openapi.json"), mapper.writerWithDefaultPrettyPrinter().writeValueAsString(actual));
        var expected = new ObjectMapper(new YAMLFactory()).readTree(Path.of("../api-contract/api.yaml").toFile());
        assertThat(actual.path("info")).isEqualTo(expected.path("info"));
        assertThat(actual.path("tags")).isEqualTo(expected.path("tags"));
        assertThat(actual.path("paths").fieldNames()).toIterable().containsExactlyInAnyOrderElementsOf(() -> expected.path("paths").fieldNames());
        for (String path : new String[]{"/api/v1/machines/{machineId}/slots", "/api/v1/machines/{machineId}/slots/{slotId}", "/api/v1/machines/{machineId}/slots/{slotId}/status"})
            assertThat(canonical(actual.path("paths").path(path))).as("complete slot operations %s", path)
                    .isEqualTo(canonical(expected.path("paths").path(path)));
        for (String schema : new String[]{"CreateMachineSlotRequest", "UpdateMachineSlotRequest", "UpdateMachineSlotStatusRequest", "MachineSlotResponse",
                "MachineSlotPageResponse", "ApiResponseMachineSlotResponse", "ApiResponseMachineSlotPageResponse"})
            assertThat(canonical(actual.at("/components/schemas/" + schema))).as("complete schema %s", schema)
                    .isEqualTo(canonical(expected.at("/components/schemas/" + schema)));
        var create = actual.at("/components/schemas/CreateMachineSlotRequest");
        assertThat(create.path("additionalProperties").asBoolean(true)).isFalse();
        assertThat(create.path("required")).hasSize(2);
        assertThat(create.at("/properties/slotCode/maxLength").asInt()).isEqualTo(32);
        assertThat(create.at("/properties/capacity/type").asText()).isEqualTo("integer");
        assertThat(create.at("/properties/capacity/minimum").asInt()).isEqualTo(1);
        assertThat(create.at("/properties/capacity/maximum").asLong()).isEqualTo(Integer.MAX_VALUE);
        assertThat(actual.at("/components/schemas/UpdateMachineSlotRequest/properties").fieldNames()).toIterable().containsExactly("capacity");
        assertThat(actual.at("/components/schemas/UpdateMachineSlotStatusRequest/properties/status/enum")).contains(
                mapper.getNodeFactory().textNode("ACTIVE"), mapper.getNodeFactory().textNode("INACTIVE"), mapper.getNodeFactory().textNode("ERROR"));
        assertThat(actual.at("/components/schemas/MachineSlotResponse/properties").fieldNames()).toIterable()
                .containsExactlyInAnyOrder("id", "machineId", "slotCode", "capacity", "status", "createdAt", "updatedAt");
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
