package com.fruitmachine.backend.order;

import com.fruitmachine.backend.support.AbstractOrderIntegrationTest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(OutputCaptureExtension.class)
class KioskCredentialIntegrationTest extends AbstractOrderIntegrationTest {
    private String path(UUID machineId) { return "/api/v1/machines/" + machineId + "/kiosk-credentials"; }

    @Test
    void adminIssuesCredentialShownOnceAndOnlyPrefixAndSha256HashAreStored() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        var issued = fixtures.api("POST", path(machine), null, admin.token(), 201);
        String apiKey = issued.path("apiKey").asText();
        String prefix = issued.path("keyPrefix").asText();
        assertThat(apiKey).matches("fvk_[a-z0-9]{12}_[A-Za-z0-9_-]{43}").startsWith("fvk_" + prefix + "_");
        assertThat(issued.path("status").asText()).isEqualTo("ACTIVE");
        assertThat(issued.path("machineId").asText()).isEqualTo(machine.toString());

        var row = jdbc.queryForMap("SELECT key_prefix, secret_hash, status, created_by FROM kiosk_credentials WHERE id=?", UUID.fromString(issued.path("credentialId").asText()));
        String secret = apiKey.substring(("fvk_" + prefix + "_").length());
        String expectedHash = java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(secret.getBytes(StandardCharsets.UTF_8)));
        assertThat(row.get("key_prefix")).isEqualTo(prefix);
        assertThat(row.get("secret_hash")).isEqualTo(expectedHash);
        assertThat(row.get("created_by")).isEqualTo(admin.id());
        assertThat(jdbc.queryForList("SELECT * FROM kiosk_credentials WHERE secret_hash=? OR key_prefix=? OR id::text=?", apiKey, apiKey, apiKey)).isEmpty();

        var list = fixtures.api("GET", path(machine), null, admin.token(), 200);
        assertThat(list).hasSize(1);
        assertThat(list.toString()).doesNotContain(apiKey, secret, expectedHash, "apiKey", "secretHash");
        assertThat(list.get(0).fieldNames()).toIterable().containsExactlyInAnyOrder("credentialId", "keyPrefix", "status", "createdAt", "createdBy", "revokedAt", "revokedBy");
    }

    @Test
    void issuingAgainRevokesThePreviousKeyAndKeepsHistory() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        String first = issueKey(machine);
        kioskData("GET", "/api/v1/kiosk/me", first, null, 200);
        String second = issueKey(machine);
        assertThat(second).isNotEqualTo(first);
        kioskJson("GET", "/api/v1/kiosk/me", first, null, 401);
        kioskData("GET", "/api/v1/kiosk/me", second, null, 200);
        var list = fixtures.api("GET", path(machine), null, admin.token(), 200);
        assertThat(list).hasSize(2);
        assertThat(list.findValuesAsText("status")).containsExactlyInAnyOrder("ACTIVE", "REVOKED");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM kiosk_credentials WHERE machine_id=? AND status='ACTIVE'", Long.class, machine)).isEqualTo(1);
    }

    @Test
    void revokeIsIdempotentScopedToTheMachineAndRevokedKeysAreRejected() throws Exception {
        UUID machine = fixtures.machine(admin.token()), other = fixtures.machine(admin.token());
        var issued = fixtures.api("POST", path(machine), null, admin.token(), 201);
        String key = issued.path("apiKey").asText();
        String credential = issued.path("credentialId").asText();
        fixtures.api("POST", path(other) + "/" + credential + "/revoke", null, admin.token(), 404);
        fixtures.api("POST", path(UUID.randomUUID()) + "/" + credential + "/revoke", null, admin.token(), 404);
        fixtures.api("POST", path(machine) + "/" + UUID.randomUUID() + "/revoke", null, admin.token(), 404);
        kioskData("GET", "/api/v1/kiosk/me", key, null, 200);

        var revoked = fixtures.api("POST", path(machine) + "/" + credential + "/revoke", null, admin.token(), 200);
        assertThat(revoked.path("status").asText()).isEqualTo("REVOKED");
        assertThat(revoked.path("revokedBy").asText()).isEqualTo(admin.id().toString());
        var again = fixtures.api("POST", path(machine) + "/" + credential + "/revoke", null, admin.token(), 200);
        assertThat(again.path("revokedAt")).isEqualTo(revoked.path("revokedAt"));
        kioskJson("GET", "/api/v1/kiosk/me", key, null, 401);
    }

    @Test
    void missingMachineIs404AndOnlyAdminMayUseCredentialApis() throws Exception {
        fixtures.api("POST", path(UUID.randomUUID()), null, admin.token(), 404);
        fixtures.api("GET", path(UUID.randomUUID()), null, admin.token(), 404);
        UUID machine = fixtures.machine(admin.token());
        String credential = fixtures.api("POST", path(machine), null, admin.token(), 201).path("credentialId").asText();
        for (String[] call : new String[][]{{"POST", path(machine)}, {"GET", path(machine)}, {"POST", path(machine) + "/" + credential + "/revoke"}}) {
            fixtures.response(call[0], call[1], null, staff.token(), 403);
            fixtures.response(call[0], call[1], null, null, 401);
        }
        assertThat(jdbc.queryForObject("SELECT status FROM kiosk_credentials WHERE id=?", String.class, UUID.fromString(credential))).isEqualTo("ACTIVE");
    }

    @Test
    void kioskAuthenticationRejectsEveryInvalidKeyUniformlyAndNeverLogsTheKey(CapturedOutput output) throws Exception {
        UUID machine = fixtures.machine(admin.token());
        String key = issueKey(machine);
        String prefix = key.substring(4, 16), secret = key.substring(17);
        String[] bad = {"", "garbage", "fvk_" + prefix, "fvk_" + prefix + "_short", "fvk_zzzzzzzzzzzz_" + secret,
                "fvk_" + prefix + "_" + "A".repeat(43), "FVK_" + prefix + "_" + secret, " " + key, key + "x"};
        String reference = null;
        for (String candidate : bad) {
            var result = kioskCall("GET", "/api/v1/kiosk/me", candidate, null);
            assertThat(result.getResponse().getStatus()).as("key %s", candidate).isEqualTo(401);
            String message = json.readTree(result.getResponse().getContentAsString()).path("message").asText();
            if (reference == null) reference = message;
            assertThat(message).isEqualTo(reference);
        }
        assertThat(kioskCall("GET", "/api/v1/kiosk/me", null, null).getResponse().getStatus()).isEqualTo(401);
        var me = kioskData("GET", "/api/v1/kiosk/me", key, null, 200);
        assertThat(me.path("machineId").asText()).isEqualTo(machine.toString());
        assertThat(output.getAll()).doesNotContain(key, secret);
    }

    @Test
    void userJwtOnKioskApisIs403AndKioskKeyOnManagementApisIs401() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        String key = issueKey(machine);
        fixtures.response("GET", "/api/v1/kiosk/me", null, admin.token(), 403);
        fixtures.response("GET", "/api/v1/kiosk/catalog", null, staff.token(), 403);
        fixtures.response("GET", "/api/v1/kiosk/me", null, null, 401);
        for (String managementPath : new String[]{"/api/v1/orders", "/api/v1/machines", "/api/v1/products", "/api/v1/inventory", path(machine)}) {
            assertThat(kioskCall("GET", managementPath, key, null).getResponse().getStatus()).as(managementPath).isEqualTo(401);
        }
        // A request that carries both credentials is ambiguous and rejected.
        var both = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/v1/kiosk/me")
                .header("Authorization", "Bearer " + admin.token()).header("X-Kiosk-Key", key)).andReturn();
        assertThat(both.getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void kioskOfInactiveOrMaintenanceMachineStillAuthenticates() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        String key = issueKey(machine);
        for (String status : new String[]{"INACTIVE", "MAINTENANCE"}) {
            fixtures.api("PATCH", "/api/v1/machines/" + machine + "/status", Map.of("status", status), admin.token(), 200);
            var me = kioskData("GET", "/api/v1/kiosk/me", key, null, 200);
            assertThat(me.path("machineStatus").asText()).isEqualTo(status);
        }
    }
}
