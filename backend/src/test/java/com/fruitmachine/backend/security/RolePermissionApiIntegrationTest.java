package com.fruitmachine.backend.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;

/** Issue #48 section 12: role & permission APIs, lockout guard, audit, concurrency. */
class RolePermissionApiIntegrationTest extends AbstractCoreIntegrationTest {
    static final UUID ADMIN = UUID.fromString("10000000-0000-0000-0000-000000000001");
    static final UUID STAFF = UUID.fromString("10000000-0000-0000-0000-000000000002");
    static final List<String> STAFF_CODES = List.of("ALERT_MANAGE", "ALERT_READ", "BATCH_CREATE", "BATCH_READ", "INVENTORY_READ", "INVENTORY_WRITE",
            "MACHINE_READ", "MAINTENANCE_COMMAND_EXECUTE", "MAINTENANCE_COMMAND_READ", "MAINTENANCE_PLAN_READ", "ORDER_READ", "PRICING_READ", "PRODUCT_READ",
            "RESTOCK_EXECUTE", "WORK_ORDER_EXECUTE", "WORK_ORDER_READ_ASSIGNED");

    @org.junit.jupiter.api.BeforeEach
    @AfterEach
    void restoreSeededMapping() {
        jdbc.update("DELETE FROM audit_logs WHERE action = 'ROLE_PERMISSIONS_CHANGED'");
        jdbc.update("DELETE FROM role_permissions");
        jdbc.update("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions", ADMIN);
        jdbc.update("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE code = ANY (?)", STAFF,
                STAFF_CODES.toArray(String[]::new));
    }

    JsonNode replace(UUID role, List<String> codes, String token, int expected) throws Exception {
        return fixtures.response("PUT", "/api/v1/roles/" + role + "/permissions", Map.of("permissions", codes), token, expected);
    }

    List<String> codes(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(node -> out.add(node.asText()));
        return out;
    }

    @Test
    void adminListsPermissionsAndRoles() throws Exception {
        var permissions = fixtures.api("GET", "/api/v1/permissions", null, admin.token(), 200);
        assertThat(permissions).hasSize(35);
        List<String> listed = new ArrayList<>();
        permissions.forEach(p -> { listed.add(p.path("code").asText()); assertThat(p.path("description").asText()).isNotBlank(); });
        assertThat(listed).isSorted().containsExactlyInAnyOrderElementsOf(Permissions.ALL);

        var roles = fixtures.api("GET", "/api/v1/roles", null, admin.token(), 200);
        assertThat(roles).hasSize(2);
        assertThat(roles.get(0).path("name").asText()).isEqualTo("ADMIN");
        assertThat(codes(roles.get(0).path("permissions"))).isSorted().containsExactlyInAnyOrderElementsOf(Permissions.ALL);
        assertThat(roles.get(1).path("name").asText()).isEqualTo("STAFF");
        assertThat(codes(roles.get(1).path("permissions"))).containsExactlyElementsOf(STAFF_CODES);

        var role = fixtures.api("GET", "/api/v1/roles/" + STAFF, null, admin.token(), 200);
        assertThat(role.path("id").asText()).isEqualTo(STAFF.toString());
        assertThat(role.path("description").asText()).isNotBlank();
        assertThat(codes(role.path("permissions"))).containsExactlyElementsOf(STAFF_CODES);
        assertThat(role.fieldNames()).toIterable().containsExactlyInAnyOrder("id", "name", "description", "permissions");
    }

    @Test
    void replacingStaffPermissionsAppliesToTheNextStaffRequestAndIsAudited() throws Exception {
        fixtures.api("GET", "/api/v1/products?size=1", null, staff.token(), 200);
        var updated = replace(STAFF, List.of("MACHINE_READ", "INVENTORY_WRITE", "INVENTORY_READ"), admin.token(), 200).path("data");
        assertThat(codes(updated.path("permissions"))).containsExactly("INVENTORY_READ", "INVENTORY_WRITE", "MACHINE_READ");
        // Same STAFF token, next request: PRODUCT_READ is gone, MACHINE_READ is kept.
        fixtures.response("GET", "/api/v1/products?size=1", null, staff.token(), 403);
        fixtures.api("GET", "/api/v1/machines?size=1", null, staff.token(), 200);

        var audit = jdbc.queryForMap("SELECT user_id, entity_type, entity_id, old_value::text AS old_value, new_value::text AS new_value FROM audit_logs "
                + "WHERE action = 'ROLE_PERMISSIONS_CHANGED' ORDER BY created_at DESC LIMIT 1");
        assertThat(audit.get("user_id")).isEqualTo(admin.id());
        assertThat(audit.get("entity_type")).isEqualTo("Role");
        assertThat(audit.get("entity_id")).isEqualTo(STAFF);
        assertThat(codes(json.readTree((String) audit.get("old_value")).path("permissions"))).containsExactlyElementsOf(STAFF_CODES);
        assertThat(codes(json.readTree((String) audit.get("new_value")).path("permissions"))).containsExactly("INVENTORY_READ", "INVENTORY_WRITE", "MACHINE_READ");

        // Empty set is allowed: the role keeps its members but has no access.
        replace(STAFF, List.of(), admin.token(), 200);
        fixtures.response("GET", "/api/v1/machines?size=1", null, staff.token(), 403);
    }

    @Test
    void unknownDuplicateAndMalformedRequestsAreRejected() throws Exception {
        var unknown = replace(STAFF, List.of("PRODUCT_READ", "NOT_A_PERMISSION", "ALSO_UNKNOWN"), admin.token(), 400);
        assertThat(unknown.path("fieldErrors").path("permissions").asText()).contains("ALSO_UNKNOWN", "NOT_A_PERMISSION").doesNotContain("PRODUCT_READ");
        var duplicate = replace(STAFF, List.of("PRODUCT_READ", "PRODUCT_READ"), admin.token(), 400);
        assertThat(duplicate.path("fieldErrors").path("permissions").asText()).contains("PRODUCT_READ");
        fixtures.response("PUT", "/api/v1/roles/" + STAFF + "/permissions", Map.of(), admin.token(), 400);
        fixtures.response("PUT", "/api/v1/roles/" + STAFF + "/permissions", Map.of("permissions", List.of("PRODUCT_READ"), "name", "X"), admin.token(), 400);
        fixtures.response("PUT", "/api/v1/roles/" + STAFF + "/permissions", Map.of("permissions", List.of(" ")), admin.token(), 400);
        fixtures.response("PUT", "/api/v1/roles/not-a-uuid/permissions", Map.of("permissions", List.of()), admin.token(), 400);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_logs WHERE action = 'ROLE_PERMISSIONS_CHANGED'", Long.class)).isZero();
        assertThat(jdbc.queryForList("SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? ORDER BY p.code",
                String.class, STAFF)).containsExactlyElementsOf(STAFF_CODES);
    }

    @Test
    void adminRoleCannotLoseUserWriteOrPermissionManage() throws Exception {
        List<String> all = new ArrayList<>(Permissions.ALL);
        for (String required : Permissions.ADMIN_REQUIRED) {
            List<String> without = new ArrayList<>(all);
            without.remove(required);
            replace(ADMIN, without, admin.token(), 409);
        }
        replace(ADMIN, List.of(), admin.token(), 409);
        // Keeping both is fine, even when everything else is removed.
        replace(ADMIN, List.of("USER_WRITE", "PERMISSION_MANAGE"), admin.token(), 200);
        fixtures.response("GET", "/api/v1/products?size=1", null, admin.token(), 403);
        fixtures.api("GET", "/api/v1/roles", null, admin.token(), 200);
    }

    @Test
    void missingRoleIs404AndOnlyPermissionManagersMayCallTheApis() throws Exception {
        fixtures.response("GET", "/api/v1/roles/" + UUID.randomUUID(), null, admin.token(), 404);
        replace(UUID.randomUUID(), List.of("PRODUCT_READ"), admin.token(), 404);
        UUID machine = fixtures.machine(admin.token());
        String kioskKey = fixtures.api("POST", "/api/v1/machines/" + machine + "/kiosk-credentials", null, admin.token(), 201).path("apiKey").asText();
        for (String[] call : new String[][]{{"GET", "/api/v1/permissions"}, {"GET", "/api/v1/roles"}, {"GET", "/api/v1/roles/" + STAFF},
                {"PUT", "/api/v1/roles/" + STAFF + "/permissions"}}) {
            String body = call[0].equals("PUT") ? "{\"permissions\":[\"PRODUCT_READ\"]}" : null;
            fixtures.response(call[0], call[1], body == null ? null : json.readTree(body), staff.token(), 403);
            fixtures.response(call[0], call[1], body == null ? null : json.readTree(body), null, 401);
            var kiosk = request(HttpMethod.valueOf(call[0]), call[1]).header("X-Kiosk-Key", kioskKey).contentType("application/json");
            if (body != null) kiosk.content(body);
            assertThat(mvc.perform(kiosk).andReturn().getResponse().getStatus()).as("kiosk key on %s", call[1]).isEqualTo(401);
        }
        // STAFF with an invalid body still gets 403, never 400.
        fixtures.response("PUT", "/api/v1/roles/" + STAFF + "/permissions", Map.of(), staff.token(), 403);
    }

    @Test
    void concurrentReplacementsOfOneRoleNeverLoseAnUpdate() throws Exception {
        // Twelve distinct sets (one code each), four replacements released together per round.
        List<List<String>> all = Permissions.ALL.subList(0, 12).stream().map(List::of).toList();
        for (int round = 0; round < 3; round++) {
            var sets = all.subList(round * 4, round * 4 + 4);
            var pool = Executors.newFixedThreadPool(sets.size());
            var start = new CountDownLatch(1);
            List<java.util.concurrent.Future<Integer>> results = new ArrayList<>();
            for (List<String> set : sets) {
                Callable<Integer> call = () -> {
                    start.await();
                    var put = request(HttpMethod.PUT, "/api/v1/roles/" + STAFF + "/permissions").header("Authorization", "Bearer " + admin.token())
                            .contentType("application/json").content(json.writeValueAsString(Map.of("permissions", set)));
                    return mvc.perform(put).andReturn().getResponse().getStatus();
                };
                results.add(pool.submit(call));
            }
            start.countDown();
            for (var result : results) assertThat(result.get(30, TimeUnit.SECONDS)).isEqualTo(200);
            pool.shutdown();
        }
        // Each change saw the previous one: walking old -> new from the seeded set visits every audit row exactly once and ends
        // at the final state. A lost update would leave two rows with the same old value and break the chain.
        var rows = jdbc.queryForList("SELECT old_value::text AS old_value, new_value::text AS new_value FROM audit_logs "
                + "WHERE action = 'ROLE_PERMISSIONS_CHANGED' AND entity_id = ?", STAFF);
        assertThat(rows).hasSize(12);
        Map<List<String>, List<String>> next = new java.util.HashMap<>();
        for (var row : rows) {
            var old = codes(json.readTree((String) row.get("old_value")).path("permissions"));
            assertThat(next.put(old, codes(json.readTree((String) row.get("new_value")).path("permissions")))).as("two changes based on %s", old).isNull();
        }
        List<String> previous = STAFF_CODES;
        for (int step = 0; step < rows.size(); step++) {
            assertThat(next).as("chain step %d", step).containsKey(previous);
            previous = next.get(previous);
        }
        assertThat(jdbc.queryForList("SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? ORDER BY p.code",
                String.class, STAFF)).isEqualTo(previous);
    }
}
