package com.fruitmachine.backend.machine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.dispense.service.DispenseReport;
import com.fruitmachine.backend.dispense.service.DispenseService;
import com.fruitmachine.backend.machine.service.MachineEventRecorder;
import com.fruitmachine.backend.machine.service.MachineService;
import com.fruitmachine.backend.mqtt.MachineMessageHandler;
import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;

/** Issue #56: machine history (MACHINE and BACKEND events), its timeline API and the audit log read API. */
@ExtendWith(OutputCaptureExtension.class)
class MachineEventLoggingIntegrationTest extends AbstractWebhookIntegrationTest {
    static final Path EXAMPLES = Path.of("../api-contract/mqtt/examples");

    @Autowired MachineMessageHandler messages;
    @Autowired DispenseService dispense;
    @Autowired MachineService machineService;
    @Autowired TransactionTemplate transactions;
    @MockitoSpyBean MachineEventRecorder recorder;
    int sequence;

    void send(String code, String channel, String messageId, String payload) {
        messages.handle(code, channel, ("{\"schemaVersion\":1,\"messageId\":\"" + messageId + "\",\"machineCode\":\"" + code
                + "\",\"payload\":" + payload + "}").getBytes(StandardCharsets.UTF_8));
    }

    String next() {
        return "m-" + (++sequence) + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    String codeOf(UUID machine) {
        return jdbc.queryForObject("SELECT code FROM machines WHERE id=?", String.class, machine);
    }

    List<Map<String, Object>> history(UUID machine) {
        return jdbc.queryForList("SELECT event_type, source, message_id, payload::text AS payload FROM machine_events WHERE machine_id=? ORDER BY created_at, id", machine);
    }

    List<String> types(UUID machine) {
        return history(machine).stream().map(row -> (String) row.get("event_type")).toList();
    }

    @BeforeEach
    void freshTimeline() {
        sequence = 0;
    }

    // ---- 7. migration ----

    @Test
    void v16ChecksAndIndexesHoldAndAuditLogReadIsAdminOnly() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        assertThatThrownBy(() -> jdbc.update("INSERT INTO machine_events (machine_id, event_type, source) VALUES (?, 'X', 'MACHINE')", machine))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO machine_events (machine_id, event_type, source, message_id) VALUES (?, 'X', 'MACHINE', ' ')", machine))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO machine_events (machine_id, event_type, source, message_id) VALUES (?, 'X', 'OTHER', 'm')", machine))
                .isInstanceOf(DataIntegrityViolationException.class);
        jdbc.update("INSERT INTO machine_events (machine_id, event_type, source) VALUES (?, 'BACKEND_TEST', 'BACKEND')", machine);
        jdbc.update("INSERT INTO machine_events (machine_id, event_type, message_id) VALUES (?, 'X', 'dup')", machine);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO machine_events (machine_id, event_type, message_id) VALUES (?, 'Y', 'dup')", machine))
                .isInstanceOf(org.springframework.dao.DuplicateKeyException.class);
        // The same messageId on another machine is a different message.
        jdbc.update("INSERT INTO machine_events (machine_id, event_type, message_id) VALUES (?, 'X', 'dup')", fixtures.machine(admin.token()));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM pg_indexes WHERE indexname IN ('uq_machine_events_machine_message', 'ix_machine_events_machine_type_time')",
                Long.class)).isEqualTo(2);
        assertThat(jdbc.queryForList("""
                SELECT r.name FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
                WHERE p.code = 'AUDIT_LOG_READ'""", String.class)).containsExactly("ADMIN");
        assertThat(jdbc.queryForObject("SELECT id FROM permissions WHERE code='AUDIT_LOG_READ'", UUID.class))
                .isEqualTo(UUID.fromString("20000000-0000-0000-0000-000000000016"));
    }

    // ---- 8. machine messages ----

    @Test
    void contractExamplesAreStoredOnceWithTheirTypeAndPayloadAndHeartbeatsAndTelemetryAreNot() throws Exception {
        jdbc.update("UPDATE machines SET code = 'OLD-' || id WHERE code = 'FV-DEV-001'");
        UUID machine = fixtures.machine(admin.token());
        jdbc.update("UPDATE machines SET code = 'FV-DEV-001' WHERE id = ?", machine);
        List<String> expected = new ArrayList<>();
        try (Stream<Path> files = Files.list(EXAMPLES)) {
            for (Path file : files.sorted().toList()) {
                String name = file.getFileName().toString();
                String channel = name.startsWith("event-") ? "events" : name.startsWith("status-") ? "status"
                        : name.startsWith("heartbeat") ? "heartbeat" : name.startsWith("telemetry") ? "telemetry" : null;
                if (channel == null) continue;
                byte[] body = Files.readAllBytes(file);
                messages.handle("FV-DEV-001", channel, body);
                messages.handle("FV-DEV-001", channel, body);
                JsonNode envelope = json.readTree(body);
                if (channel.equals("events")) expected.add(envelope.at("/payload/eventType").asText());
                if (channel.equals("status")) expected.add(envelope.at("/payload/state").asText().equals("ONLINE") ? "STATUS_ONLINE" : "STATUS_OFFLINE");
            }
        }
        var rows = jdbc.queryForList("SELECT event_type, source, message_id, payload::text AS payload FROM machine_events WHERE machine_id=? AND source='MACHINE'", machine);
        assertThat(rows).extracting(r -> r.get("event_type")).containsExactlyInAnyOrderElementsOf(expected);
        assertThat(rows).hasSize(8);
        // status-online (uptime 12) arrives after heartbeat (uptime 12345): the backend records that reboot, nothing else.
        assertThat(jdbc.queryForList("SELECT event_type FROM machine_events WHERE machine_id=? AND source='BACKEND'", String.class, machine))
                .containsExactly("BACKEND_REBOOT_DETECTED");
        assertThat(rows).extracting(r -> r.get("event_type")).doesNotContain("heartbeat", "telemetry", "STATUS_HEARTBEAT");
        // The stored payload is the envelope payload as sent.
        var aborted = rows.stream().filter(r -> r.get("event_type").equals("DISPENSE_ABORTED")).findFirst().orElseThrow();
        JsonNode example = json.readTree(EXAMPLES.resolve("event-dispense-aborted-no-bowl.json").toFile());
        assertThat(json.readTree((String) aborted.get("payload"))).isEqualTo(example.path("payload"));
        assertThat(aborted.get("message_id")).isEqualTo(example.path("messageId").asText());
    }

    @Test
    void aRedeliveredDispenseEventIsStoredOnceAndStillHandledIdempotently() throws Exception {
        PlacedOrder order = paidOrder();
        UUID machine = order.shop().machineId();
        String code = codeOf(machine), command = commandCode(order);
        String completed = "{\"eventType\":\"DISPENSE_COMPLETED\",\"details\":{\"commandId\":\"" + command + "\",\"columnCode\":\"A\"}}";
        send(code, "events", "redelivered-1", completed);
        send(code, "events", "redelivered-1", completed);
        // A repeat with a new messageId (the firmware answering a resend) is a new history row, but no second sale.
        send(code, "events", "redelivered-2", completed);
        assertThat(types(machine)).containsExactly("DISPENSE_COMPLETED", "DISPENSE_COMPLETED");
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE reference_id=? AND type='SALE'", order.orderId())).isEqualTo(1);
    }

    @Test
    void invalidMessagesLeaveNoRowAndUnknownOrMissingEventTypesAreKept() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        String code = codeOf(machine);
        messages.handle(code, "events", "{\"messageId\":\"x\",\"machineCode\":\"%s\",\"payload\":{\"eventType\":\"FAULT\"}}".formatted(code).getBytes());
        messages.handle(code, "events", "not json".getBytes());
        send(code, "status", next(), "{\"state\":\"SLEEPING\"}");
        send(code, "status", next(), "{\"state\":\"ONLINE\",\"firmwareVersion\":\" \"}");
        assertThat(history(machine)).isEmpty();

        send(code, "events", next(), "{\"eventType\":\"SOMETHING_FROM_FIRMWARE_2\",\"details\":{\"x\":1}}");
        send(code, "events", next(), "{\"details\":{}}");
        send(code, "events", next(), "{\"eventType\":\"" + "T".repeat(80) + "\"}");
        assertThat(types(machine)).containsExactly("SOMETHING_FROM_FIRMWARE_2", "UNSPECIFIED", "T".repeat(64));
    }

    @Test
    void aHistoryFailureIsLoggedAndTheDispenseEventIsStillApplied(CapturedOutput output) throws Exception {
        PlacedOrder order = paidOrder();
        String code = codeOf(order.shop().machineId());
        doThrow(new IllegalStateException("simulated history outage")).when(recorder)
                .recordMachineMessage(any(), anyString(), anyString(), any(), any());
        assertThatCode(() -> send(code, "events", next(),
                "{\"eventType\":\"DISPENSE_COMPLETED\",\"details\":{\"commandId\":\"" + commandCode(order) + "\"}}")).doesNotThrowAnyException();
        assertThat(orderStatus(order.orderId())).isEqualTo("COMPLETED");
        assertThat(history(order.shop().machineId())).isEmpty();
        assertThat(output.getAll()).contains("ERROR").contains("could not be written to the machine history; processing continues");
    }

    // ---- 9. backend events ----

    @Test
    void backendDecisionsAreRecordedAfterCommitWithIdsAndReasonsOnly() throws Exception {
        PlacedOrder order = paidOrder();
        UUID machine = order.shop().machineId();
        String code = codeOf(machine), command = commandCode(order);
        send(code, "status", next(), "{\"state\":\"ONLINE\",\"firmwareVersion\":\"0.3.0\",\"uptimeSeconds\":500}");
        clock.advance(Duration.ofSeconds(1));
        send(code, "events", next(), "{\"eventType\":\"DISPENSE_ACCEPTED\",\"details\":{\"commandId\":\"" + command + "\"}}");
        clock.advance(Duration.ofSeconds(1));
        send(code, "events", next(), "{\"eventType\":\"DISPENSE_ABORTED\",\"details\":{\"commandId\":\"" + command + "\",\"reason\":\"NO_BOWL_DETECTED\"}}");
        // The Definition of Done timeline, oldest first.
        assertThat(types(machine)).containsExactly("STATUS_ONLINE", "DISPENSE_ACCEPTED", "DISPENSE_ABORTED", "BACKEND_DISPENSE_FAILED",
                "BACKEND_MAINTENANCE_ENTERED");
        var failed = history(machine).stream().filter(r -> r.get("event_type").equals("BACKEND_DISPENSE_FAILED")).findFirst().orElseThrow();
        assertThat(failed.get("source")).isEqualTo("BACKEND");
        assertThat(failed.get("message_id")).isNull();
        JsonNode payload = json.readTree((String) failed.get("payload"));
        assertThat(payload.fieldNames()).toIterable().containsExactlyInAnyOrder("commandId", "commandCode", "orderId", "slotId", "slotCode", "reason", "bowlReturned");
        assertThat(payload.path("reason").asText()).isEqualTo("NO_BOWL_DETECTED");
        assertThat(payload.path("slotCode").asText()).isEqualTo("A");
        assertThat(payload.path("orderId").asText()).isEqualTo(order.orderId().toString());

        // Late success, then a reboot reported by a lower uptime.
        dispense.handleMachineEvent(code, DispenseService.EVENT_COMPLETED, command);
        clock.advance(Duration.ofSeconds(1));
        send(code, "heartbeat", next(), "{\"state\":\"ONLINE\",\"uptimeSeconds\":3,\"firmwareVersion\":\"0.3.0\"}");
        var all = types(machine);
        assertThat(all).containsSubsequence("BACKEND_DISPENSE_LATE_SUCCESS", "BACKEND_REBOOT_DETECTED");
        var reboot = history(machine).stream().filter(r -> r.get("event_type").equals("BACKEND_REBOOT_DETECTED")).findFirst().orElseThrow();
        assertThat(json.readTree((String) reboot.get("payload")).fieldNames()).toIterable().containsExactlyInAnyOrder("previousUptimeSeconds", "newUptimeSeconds");

        // Multi-bowl on another order.
        PlacedOrder second = paidOrder();
        dispense.handleMachineEvent(codeOf(second.shop().machineId()), new DispenseReport(DispenseService.EVENT_COMPLETED, commandCode(second), null, 2));
        assertThat(types(second.shop().machineId())).containsExactly("BACKEND_MAINTENANCE_ENTERED", "BACKEND_DISPENSE_MULTIPLE_BOWLS");
        var bowls = history(second.shop().machineId()).get(1);
        assertThat(json.readTree((String) bowls.get("payload")).path("bowlCount").asInt()).isEqualTo(2);
        // No customer or secret data in any BACKEND payload.
        for (UUID id : List.of(machine, second.shop().machineId())) {
            for (var row : history(id)) {
                if (row.get("source").equals("BACKEND")) assertThat((String) row.get("payload")).doesNotContain("@", "password", "secret", "token", "phone");
            }
        }
    }

    @Test
    void aRolledBackDecisionLeavesNoHistory() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        jdbc.update("UPDATE machines SET status='ACTIVE' WHERE id=?", machine);
        transactions.executeWithoutResult(status -> {
            machineService.enterMaintenanceBySystem(machine, "TEST_ROLLBACK");
            status.setRollbackOnly();
        });
        assertThat(history(machine)).isEmpty();
        assertThat(jdbc.queryForObject("SELECT status FROM machines WHERE id=?", String.class, machine)).isEqualTo("ACTIVE");
        transactions.executeWithoutResult(status -> machineService.enterMaintenanceBySystem(machine, "TEST_COMMIT"));
        assertThat(types(machine)).containsExactly("BACKEND_MAINTENANCE_ENTERED");
    }

    // ---- 10. timeline API ----

    @Test
    void timelineIsFilteredPagedNewestFirstAndProtected() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        String code = codeOf(machine);
        Instant start = clock.instant();
        for (int i = 0; i < 4; i++) {
            send(code, "events", "t-" + i, "{\"eventType\":\"" + (i % 2 == 0 ? "FAULT" : "BOOT") + "\",\"details\":{\"n\":" + i + "}}");
            clock.advance(Duration.ofSeconds(10));
        }
        jdbc.update("UPDATE machines SET status='ACTIVE' WHERE id=?", machine);
        transactions.executeWithoutResult(status -> machineService.enterMaintenanceBySystem(machine, "TEST_TIMELINE"));
        String base = "/api/v1/machines/" + machine + "/events";

        var all = fixtures.api("GET", base, null, staff.token(), 200);
        assertThat(all.path("totalElements").asLong()).isEqualTo(5);
        assertThat(all.path("size").asInt()).isEqualTo(50);
        assertThat(eventTypes(all)).containsExactly("BACKEND_MAINTENANCE_ENTERED", "BOOT", "FAULT", "BOOT", "FAULT");
        var item = all.path("content").get(1);
        assertThat(item.fieldNames()).toIterable().containsExactlyInAnyOrder("id", "eventType", "source", "messageId", "payload", "createdAt");
        assertThat(item.path("messageId").asText()).isEqualTo("t-3");
        assertThat(item.path("payload").path("details").path("n").asInt()).isEqualTo(3);
        assertThat(all.path("content").get(0).path("messageId").isNull()).isTrue();

        assertThat(fixtures.api("GET", base + "?type=FAULT", null, staff.token(), 200).path("content").findValuesAsText("messageId")).containsExactly("t-2", "t-0");
        assertThat(fixtures.api("GET", base + "?source=BACKEND", null, admin.token(), 200).path("totalElements").asLong()).isEqualTo(1);
        assertThat(fixtures.api("GET", base + "?source=MACHINE&type=BOOT", null, staff.token(), 200).path("totalElements").asLong()).isEqualTo(2);
        String window = "?from=" + start.plusSeconds(5) + "&to=" + start.plusSeconds(25);
        assertThat(fixtures.api("GET", base + window, null, staff.token(), 200).path("content").findValuesAsText("messageId")).containsExactly("t-2", "t-1");
        var page1 = fixtures.api("GET", base + "?size=2&page=1", null, staff.token(), 200);
        assertThat(eventTypes(page1)).containsExactly("FAULT", "BOOT");
        assertThat(page1.path("totalPages").asInt()).isEqualTo(3);

        Instant now = Instant.now();
        for (String bad : List.of("?size=0", "?size=201", "?page=-1", "?source=KIOSK", "?from=" + now + "&to=" + now, "?from=" + now + "&to=" + now.minusSeconds(1), "?from=nope"))
            fixtures.response("GET", base + bad, null, staff.token(), 400);
        assertThat(fixtures.api("GET", base + "?size=200", null, staff.token(), 200).path("size").asInt()).isEqualTo(200);
        fixtures.response("GET", "/api/v1/machines/" + UUID.randomUUID() + "/events", null, staff.token(), 404);
        fixtures.response("GET", "/api/v1/machines/not-a-uuid/events", null, staff.token(), 400);

        fixtures.response("GET", base, null, null, 401);
        assertThat(kioskCall("GET", base, issueKey(machine), null).getResponse().getStatus()).isEqualTo(401);
        var noRole = fixtures.staff(admin.token(), PASSWORD);
        jdbc.update("DELETE FROM user_roles WHERE user_id=?", noRole.id());
        fixtures.response("GET", base, null, noRole.token(), 403);
    }

    // ---- 11. audit log API ----

    @Test
    void auditLogShowsUserAndSystemChangesWithFiltersPagingAndAdminOnlyAccess() throws Exception {
        // A user change (#48: role permissions, replaced with the same set) and a system change (#52: automatic maintenance).
        UUID staffRole = UUID.fromString("10000000-0000-0000-0000-000000000002");
        var staffCodes = jdbc.queryForList("SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? ORDER BY p.code",
                String.class, staffRole);
        // audit_logs.created_at comes from the database clock, which may differ slightly from the JVM clock.
        Instant start = jdbc.queryForObject("SELECT now() - interval '1 minute'", java.time.OffsetDateTime.class).toInstant();
        fixtures.api("PUT", "/api/v1/roles/" + staffRole + "/permissions", Map.of("permissions", staffCodes), admin.token(), 200);
        UUID machine = fixtures.machine(admin.token());
        jdbc.update("UPDATE machines SET status='ACTIVE' WHERE id=?", machine);
        transactions.executeWithoutResult(status -> machineService.enterMaintenanceBySystem(machine, "TEST_AUDIT"));

        var byUser = fixtures.api("GET", "/api/v1/audit-logs?action=ROLE_PERMISSIONS_CHANGED&entityId=" + staffRole + "&from=" + start, null, admin.token(), 200);
        assertThat(byUser.path("totalElements").asLong()).isGreaterThanOrEqualTo(1);
        var role = byUser.path("content").get(0);
        assertThat(role.fieldNames()).toIterable().containsExactlyInAnyOrder("id", "action", "entityType", "entityId", "userId", "userEmail", "actor",
                "oldValue", "newValue", "ipAddress", "createdAt");
        assertThat(role.path("userId").asText()).isEqualTo(admin.id().toString());
        assertThat(role.path("actor").asText()).isEqualTo(role.path("userEmail").asText()).contains("@");
        assertThat(role.path("newValue").path("permissions")).hasSize(staffCodes.size());
        assertThat(role.path("oldValue").path("permissions")).hasSize(staffCodes.size());

        var bySystem = fixtures.api("GET", "/api/v1/audit-logs?entityType=Machine&entityId=" + machine, null, admin.token(), 200);
        assertThat(bySystem.path("totalElements").asLong()).isEqualTo(1);
        var auto = bySystem.path("content").get(0);
        assertThat(auto.path("action").asText()).isEqualTo("MACHINE_MAINTENANCE_AUTO");
        assertThat(auto.path("userId").isNull()).isTrue();
        assertThat(auto.path("userEmail").isNull()).isTrue();
        assertThat(auto.path("actor").asText()).isEqualTo("system");
        assertThat(auto.path("oldValue").path("status").asText()).isEqualTo("ACTIVE");
        assertThat(auto.path("newValue").path("reason").asText()).isEqualTo("TEST_AUDIT");
        var one = fixtures.api("GET", "/api/v1/audit-logs/" + auto.path("id").asText(), null, admin.token(), 200);
        assertThat(one.path("action").asText()).isEqualTo("MACHINE_MAINTENANCE_AUTO");

        assertThat(fixtures.api("GET", "/api/v1/audit-logs?userId=" + admin.id() + "&from=" + start, null, admin.token(), 200)
                .path("content").findValuesAsText("action")).contains("ROLE_PERMISSIONS_CHANGED").doesNotContain("MACHINE_MAINTENANCE_AUTO");
        var recent = fixtures.api("GET", "/api/v1/audit-logs?from=" + start + "&size=1", null, admin.token(), 200);
        assertThat(recent.path("content")).hasSize(1);
        assertThat(recent.path("content").get(0).path("action").asText()).isEqualTo("MACHINE_MAINTENANCE_AUTO");
        assertThat(recent.path("totalElements").asLong()).isGreaterThanOrEqualTo(2);
        var newest = fixtures.api("GET", "/api/v1/audit-logs?size=200", null, admin.token(), 200).path("content").findValuesAsText("createdAt");
        assertThat(newest).isSortedAccordingTo(java.util.Comparator.reverseOrder());

        for (String bad : List.of("?size=201", "?page=-1", "?entityId=nope", "?userId=nope", "?from=" + start + "&to=" + start))
            fixtures.response("GET", "/api/v1/audit-logs" + bad, null, admin.token(), 400);
        fixtures.response("GET", "/api/v1/audit-logs/" + UUID.randomUUID(), null, admin.token(), 404);
        fixtures.response("GET", "/api/v1/audit-logs/nope", null, admin.token(), 400);

        fixtures.response("GET", "/api/v1/audit-logs", null, staff.token(), 403);
        fixtures.response("GET", "/api/v1/audit-logs/" + auto.path("id").asText(), null, staff.token(), 403);
        fixtures.response("GET", "/api/v1/audit-logs", null, null, 401);
        // Read-only: no write endpoint exists, even for ADMIN.
        for (String method : List.of("POST", "PUT", "PATCH", "DELETE")) {
            fixtures.response(method, "/api/v1/audit-logs" + (method.equals("POST") ? "" : "/" + auto.path("id").asText()), Map.of(), admin.token(), 405);
        }
    }

    // ---- helpers ----

    /** eventType of each item only (payloads of MACHINE events carry their own eventType). */
    private static List<String> eventTypes(JsonNode page) {
        List<String> types = new ArrayList<>();
        page.path("content").forEach(item -> types.add(item.path("eventType").asText()));
        return types;
    }

    private PlacedOrder paidOrder() throws Exception {
        PlacedOrder order = placeOrder();
        pay(order, 201);
        assertThat(paid(referenceOf(order.orderId()), "TXN-" + order.orderId(), orderTotal(order.orderId()))).isEqualTo(200);
        return order;
    }

    private String commandCode(PlacedOrder order) {
        return jdbc.queryForObject("SELECT command_code FROM dispense_commands WHERE order_id=?", String.class, order.orderId());
    }
}
