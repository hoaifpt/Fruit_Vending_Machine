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
    /**
     * ADMIN-only operations added later: role/permission APIs (#48, PERMISSION_MANAGE), the audit log (#56, AUDIT_LOG_READ) and the
     * near-expiry discount change (#61, PRICING_MANAGE).
     */
    static final Set<String> NEW_OPERATIONS = Set.of("GET /api/v1/permissions", "GET /api/v1/roles", "GET /api/v1/roles/{id}",
            "PUT /api/v1/roles/{id}/permissions", "GET /api/v1/audit-logs", "GET /api/v1/audit-logs/{id}", "PUT /api/v1/pricing/near-expiry-discount",
            "POST /api/v1/machines/{machineId}/reset", "POST /api/v1/work-orders", "GET /api/v1/work-orders", "PATCH /api/v1/work-orders/{id}",
            "POST /api/v1/work-orders/{id}/assign", "POST /api/v1/work-orders/{id}/unassign", "POST /api/v1/work-orders/{id}/cancel",
            "POST /api/v1/work-orders/{id}/alerts", "DELETE /api/v1/work-orders/{id}/alerts/{alertId}", "POST /api/v1/alerts/{alertId}/work-orders",
            "GET /api/v1/machines/{machineId}/restock-suggestions", "POST /api/v1/machines/{machineId}/restock-work-orders",
            "POST /api/v1/work-orders/{id}/restock-lines", "PATCH /api/v1/work-orders/{id}/restock-lines/{lineId}",
            "DELETE /api/v1/work-orders/{id}/restock-lines/{lineId}", "POST /api/v1/maintenance-plans", "PATCH /api/v1/maintenance-plans/{id}",
            "POST /api/v1/maintenance-plans/{id}/activate", "POST /api/v1/maintenance-plans/{id}/deactivate", "POST /api/v1/maintenance-plans/{id}/generate-now",
            "POST /api/v1/payments/{paymentId}/refund", "GET /api/v1/refunds", "GET /api/v1/refunds/candidates", "GET /api/v1/refunds/summary",
            "POST /api/v1/customer-reports/{id}/review", "POST /api/v1/customer-reports/{id}/resolve", "POST /api/v1/customer-reports/{id}/reject",
            "POST /api/v1/machines/{id}/report-token/rotate", "GET /api/v1/reports/sales/summary", "GET /api/v1/reports/sales/timeseries",
            "GET /api/v1/reports/sales/peak-hours", "GET /api/v1/reports/sales/products", "GET /api/v1/reports/sales/machines",
            "GET /api/v1/reports/sales/export");
    /**
     * Added by #53, #56, #58 and #61: ADMIN and STAFF are allowed (MACHINE_READ, ALERT_READ, ALERT_MANAGE, PRICING_READ, or any
     * signed-in user for the own notifications); anonymous and kiosk keys are unauthenticated here.
     */
    static final Set<String> NEW_READ_OPERATIONS = Set.of("GET /api/v1/machines/{machineId}/telemetry", "GET /api/v1/machines/{machineId}/telemetry/latest",
            "GET /api/v1/machines/{machineId}/events", "GET /api/v1/alerts", "GET /api/v1/alerts/{id}", "POST /api/v1/alerts/{id}/acknowledge",
            "POST /api/v1/alerts/{id}/resolve", "GET /api/v1/notifications/me", "GET /api/v1/notifications/me/unread-count",
            "POST /api/v1/notifications/{id}/read", "POST /api/v1/notifications/me/read-all", "GET /api/v1/pricing/near-expiry-discount",
            "POST /api/v1/machines/{machineId}/slots/{slotId}/maintenance-commands", "GET /api/v1/maintenance-commands",
            "GET /api/v1/maintenance-commands/{id}", "POST /api/v1/maintenance-commands/{id}/reconcile", "GET /api/v1/work-orders/me",
            "GET /api/v1/work-orders/{id}", "GET /api/v1/work-orders/{id}/events", "POST /api/v1/work-orders/{id}/start",
            "POST /api/v1/work-orders/{id}/notes", "POST /api/v1/work-orders/{id}/complete",
            "POST /api/v1/work-orders/{id}/restock-lines/{lineId}/loads", "GET /api/v1/work-orders/{id}/restock", "GET /api/v1/maintenance-plans",
            "GET /api/v1/maintenance-plans/upcoming", "GET /api/v1/maintenance-plans/{id}", "GET /api/v1/maintenance-plans/{id}/work-orders",
            "GET /api/v1/customer-reports", "GET /api/v1/customer-reports/{id}", "GET /api/v1/customer-reports/{id}/photos/{photoId}",
            "GET /api/v1/dashboard/overview");
    /** Issue #74: the public customer report form, the only anonymous operations under /api/v1 (any identity, never 401/403). */
    static final Set<String> PUBLIC_OPERATIONS = Set.of("GET /api/v1/public/report-forms/{reportToken}",
            "POST /api/v1/public/report-forms/{reportToken}/reports");
    /** Issue #74: kiosk-only operations added after the baseline (KIOSK allowed; anonymous 401; users 403). */
    static final Set<String> NEW_KIOSK_OPERATIONS = Set.of("GET /api/v1/kiosk/incident-report-link");
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
            actual.forEach((key, code) -> { if (!added(key)) lines.add(key + "\t" + code); });
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
        existing.keySet().removeIf(AuthorizationMatrixIntegrationTest::added);
        assertThat(existing).as("access behaviour of every pre-#48 operation").isEqualTo(expected);

        // Role & permission APIs: ADMIN only (PERMISSION_MANAGE); anonymous and kiosk keys are unauthenticated here.
        for (String operation : NEW_READ_OPERATIONS) {
            assertThat(actual).as(operation).containsEntry(operation + "\tANONYMOUS", 401).containsEntry(operation + "\tKIOSK", 401);
            for (String role : List.of("STAFF", "ADMIN")) assertThat(actual.get(operation + "\t" + role)).as(operation + " " + role).isNotIn(401, 403);
        }
        for (String operation : PUBLIC_OPERATIONS) {
            for (String identity : IDENTITIES) assertThat(actual.get(operation + "\t" + identity)).as(operation + " " + identity).isNotIn(401, 403);
        }
        for (String operation : NEW_KIOSK_OPERATIONS) {
            assertThat(actual).as(operation).containsEntry(operation + "\tANONYMOUS", 401).containsEntry(operation + "\tSTAFF", 403)
                    .containsEntry(operation + "\tADMIN", 403);
            assertThat(actual.get(operation + "\tKIOSK")).as(operation + " KIOSK").isNotIn(401, 403);
        }
        for (String operation : NEW_OPERATIONS) {
            assertThat(actual).as(operation).containsEntry(operation + "\tANONYMOUS", 401).containsEntry(operation + "\tKIOSK", 401)
                    .containsEntry(operation + "\tSTAFF", 403);
            assertThat(actual.get(operation + "\tADMIN")).as(operation + " ADMIN").isNotIn(401, 403);
        }
    }

    private static boolean added(String key) {
        String operation = key.split("\t")[0];
        return NEW_OPERATIONS.contains(operation) || NEW_READ_OPERATIONS.contains(operation) || PUBLIC_OPERATIONS.contains(operation)
                || NEW_KIOSK_OPERATIONS.contains(operation);
    }
}
