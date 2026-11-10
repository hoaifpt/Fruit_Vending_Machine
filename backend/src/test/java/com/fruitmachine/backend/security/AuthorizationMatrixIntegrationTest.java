package com.fruitmachine.backend.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;

/**
 * NFR-03 authorization matrix: every operation of api-contract/api.yaml x {anonymous, STAFF, ADMIN, KIOSK}, exact status code.
 * Path parameters are random UUIDs and bodies are "{}", so allowed calls end in 400/404/405 and never change data.
 * The baseline (src/test/resources/security/authorization-matrix-baseline.tsv) was recorded on the role-based code BEFORE issue #48;
 * the permission-based code must reproduce it exactly. Operations added by #48 are checked separately (NEW_OPERATIONS).
 * Re-record only deliberately: mvn test -Dtest=AuthorizationMatrixIntegrationTest -Dmatrix.record=true
 */
class AuthorizationMatrixIntegrationTest extends AbstractCoreIntegrationTest {
    static final Path BASELINE = Path.of("src/test/resources/security/authorization-matrix-baseline.tsv");
    static final Set<String> NEW_OPERATIONS = Set.of("GET /api/v1/permissions", "GET /api/v1/roles", "GET /api/v1/roles/{id}",
            "PUT /api/v1/roles/{id}/permissions");
    static final List<String> IDENTITIES = List.of("ANONYMOUS", "STAFF", "ADMIN", "KIOSK");

    record Operation(String method, String path) {
        String key() { return method + " " + path; }
    }

    static List<Operation> contractOperations() throws Exception {
        JsonNode contract = new ObjectMapper(new YAMLFactory()).readTree(Path.of("../api-contract/api.yaml").toFile());
        List<Operation> operations = new ArrayList<>();
        contract.path("paths").fields().forEachRemaining(path -> path.getValue().fieldNames().forEachRemaining(method -> {
            if (Set.of("get", "post", "put", "patch", "delete").contains(method)) operations.add(new Operation(method.toUpperCase(), path.getKey()));
        }));
        return operations;
    }

    static String concrete(String path) {
        // Random ids never match a row; {provider} uses the MOCK webhook, which rejects an unsigned body without side effects.
        return path.replace("{provider}", "mock").replaceAll("\\{[^}]+}", UUID.randomUUID().toString());
    }

    int status(Operation operation, String identity, Map<String, String> credentials) throws Exception {
        var builder = request(HttpMethod.valueOf(operation.method()), concrete(operation.path()));
        if (Set.of("POST", "PUT", "PATCH").contains(operation.method())) builder.contentType("application/json").content("{}");
        switch (identity) {
            case "STAFF", "ADMIN" -> builder.header("Authorization", "Bearer " + credentials.get(identity));
            case "KIOSK" -> builder.header("X-Kiosk-Key", credentials.get(identity));
            default -> { }
        }
        return mvc.perform(builder).andReturn().getResponse().getStatus();
    }

    Map<String, String> credentials() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        String kioskKey = fixtures.api("POST", "/api/v1/machines/" + machine + "/kiosk-credentials", null, admin.token(), 201).path("apiKey").asText();
        return Map.of("STAFF", staff.token(), "ADMIN", admin.token(), "KIOSK", kioskKey);
    }

    @Test
    void everyContractOperationKeepsItsStatusForEveryIdentity() throws Exception {
        var credentials = credentials();
        Map<String, Integer> actual = new TreeMap<>();
        for (Operation operation : contractOperations()) {
            for (String identity : IDENTITIES) actual.put(operation.key() + "\t" + identity, status(operation, identity, credentials));
        }
        if (Boolean.getBoolean("matrix.record")) {
            var lines = new ArrayList<String>();
            lines.add("# operation\tidentity\tstatus  (recorded by AuthorizationMatrixIntegrationTest; see its javadoc)");
            actual.forEach((key, code) -> { if (!NEW_OPERATIONS.contains(key.split("\t")[0])) lines.add(key + "\t" + code); });
            Files.createDirectories(BASELINE.getParent());
            Files.write(BASELINE, lines, StandardCharsets.UTF_8);
            return;
        }
        Map<String, Integer> expected = new TreeMap<>();
        for (String line : Files.readAllLines(BASELINE, StandardCharsets.UTF_8)) {
            if (line.isBlank() || line.startsWith("#")) continue;
            String[] cells = line.split("\t");
            expected.put(cells[0] + "\t" + cells[1], Integer.parseInt(cells[2]));
        }
        Map<String, Integer> existing = new TreeMap<>(actual);
        existing.keySet().removeIf(key -> NEW_OPERATIONS.contains(key.split("\t")[0]));
        assertThat(existing).as("access behaviour of every pre-#48 operation").isEqualTo(expected);

        // Role & permission APIs: ADMIN only (PERMISSION_MANAGE); anonymous and kiosk keys are unauthenticated here.
        for (String operation : NEW_OPERATIONS) {
            assertThat(actual).as(operation).containsEntry(operation + "\tANONYMOUS", 401).containsEntry(operation + "\tKIOSK", 401)
                    .containsEntry(operation + "\tSTAFF", 403);
            assertThat(actual.get(operation + "\tADMIN")).as(operation + " ADMIN").isNotIn(401, 403);
        }
    }
}
