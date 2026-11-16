package com.fruitmachine.backend.maintenance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.dispense.service.DispenseService;
import com.fruitmachine.backend.dispense.service.MachineCommandGateway;
import com.fruitmachine.backend.maintenance.service.MaintenanceCommandService;
import com.fruitmachine.backend.mqtt.MachineMessageHandler;
import com.fruitmachine.backend.mqtt.contract.MachineCommands;
import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.web.servlet.MvcResult;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;

/** Issue #64 §8–§12: maintenance commands from creation to reconciliation, on real PostgreSQL with a recording transport. */
@Import(MaintenanceCommandIntegrationTest.TransportConfig.class)
class MaintenanceCommandIntegrationTest extends AbstractWebhookIntegrationTest {
    @Autowired MaintenanceCommandService service;
    @Autowired DispenseService dispense;
    @Autowired MachineMessageHandler messages;
    @Autowired Transport transport;
    int sequence;

    /** Records what would be published; {@code connected = false} simulates a broker outage. */
    static class Transport implements MachineCommandGateway {
        final List<String> sent = new CopyOnWriteArrayList<>();
        volatile boolean connected = true;

        @Override
        public boolean sendDispense(String machineCode, String commandCode, String columnCode) {
            if (connected) sent.add("DISPENSE " + machineCode + " " + commandCode + " " + columnCode);
            return connected;
        }

        @Override
        public boolean sendMaintenance(String machineCode, String commandType, String commandCode, String columnCode) {
            if (connected) sent.add(commandType + " " + machineCode + " " + commandCode + " " + columnCode);
            return connected;
        }

        @Override
        public boolean sendReset(String machineCode, String commandCode) {
            if (connected) sent.add("RESET " + machineCode + " " + commandCode);
            return connected;
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TransportConfig {
        @Bean
        @Primary
        Transport maintenanceTransport() {
            return new Transport();
        }
    }

    @BeforeEach
    void connect() {
        transport.sent.clear();
        transport.connected = true;
    }

    // ---- fixtures ----

    record Rig(UUID machine, String code, UUID a, UUID b, UUID product) { }

    /** A machine in MAINTENANCE, online, with bowls in column A (and B when asked). */
    Rig rig(int bowlsA, int bowlsB) throws Exception {
        UUID machine = fixtures.machine(admin.token());
        UUID product = createProduct("Maintenance bowl", "35000");
        UUID a = createSlot(machine, "A", 10), b = createSlot(machine, "B", 10);
        if (bowlsA > 0) load(fixtures.batch(product, bowlsA, staff.token()), a, bowlsA);
        if (bowlsB > 0) load(fixtures.batch(product, bowlsB, staff.token()), b, bowlsB);
        jdbc.update("UPDATE machines SET status = 'MAINTENANCE' WHERE id = ?", machine);
        online(machine);
        return new Rig(machine, codeOf(machine), a, b, product);
    }

    void online(UUID machine) {
        jdbc.update("UPDATE machines SET last_seen_at = ?, last_offline_at = NULL WHERE id = ?", Timestamp.from(clock.instant()), machine);
    }

    String codeOf(UUID machine) {
        return jdbc.queryForObject("SELECT code FROM machines WHERE id = ?", String.class, machine);
    }

    MvcResult call(String method, String path, Object body, String token, String key) throws Exception {
        var builder = request(org.springframework.http.HttpMethod.valueOf(method), path).contentType("application/json");
        if (token != null) builder.header("Authorization", "Bearer " + token);
        if (key != null) builder.header("Idempotency-Key", key);
        if (body != null) builder.content(json.writeValueAsString(body));
        return mvc.perform(builder).andReturn();
    }

    JsonNode create(Rig rig, UUID slot, Map<String, Object> body, String key, int expected) throws Exception {
        var result = call("POST", "/api/v1/machines/" + rig.machine() + "/slots/" + slot + "/maintenance-commands", body, staff.token(), key);
        assertThat(result.getResponse().getStatus()).as(result.getResponse().getContentAsString()).isEqualTo(expected);
        return json.readTree(result.getResponse().getContentAsString());
    }

    JsonNode created(Rig rig, UUID slot, Map<String, Object> body) throws Exception {
        return create(rig, slot, body, "k-" + UUID.randomUUID(), 201).path("data");
    }

    static Map<String, Object> body(String operation, String reason) {
        var body = new HashMap<String, Object>();
        body.put("operation", operation);
        if (reason != null) body.put("reason", reason);
        return body;
    }

    String conflictCode(JsonNode error) {
        return error.path("message").asText().split(":")[0];
    }

    void event(Rig rig, String eventType, String commandId, Map<String, Object> extra) throws Exception {
        var details = new HashMap<String, Object>(extra);
        details.put("commandId", commandId);
        var envelope = Map.of("schemaVersion", 1, "messageId", "mc-" + (++sequence) + "-" + UUID.randomUUID().toString().substring(0, 8),
                "machineCode", rig.code(), "payload", Map.of("eventType", eventType, "details", details));
        messages.handle(rig.code(), "events", json.writeValueAsBytes(envelope));
    }

    void event(Rig rig, String eventType, String commandId) throws Exception {
        event(rig, eventType, commandId, Map.of());
    }

    Map<String, Object> row(String commandId) {
        return jdbc.queryForMap("SELECT * FROM maintenance_commands WHERE command_code = ?", commandId);
    }

    String status(String commandId) {
        return (String) row(commandId).get("status");
    }

    UUID head(UUID slot) {
        return jdbc.queryForObject("""
                SELECT id FROM inventory_items WHERE slot_id = ? AND status IN ('AVAILABLE','RESERVED','EXPIRED','DISPENSE_FAILED')
                ORDER BY loaded_at, id LIMIT 1""", UUID.class, slot);
    }

    long present(UUID slot) {
        return jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE slot_id = ? AND status IN ('AVAILABLE','RESERVED','EXPIRED','DISPENSE_FAILED')",
                Long.class, slot);
    }

    long removals(UUID command) {
        return jdbc.queryForObject("SELECT count(*) FROM inventory_transactions WHERE type = 'REMOVE' AND reference_id = ?", Long.class, command);
    }

    UUID id(JsonNode command) {
        return UUID.fromString(command.path("id").asText());
    }

    // ---- 8. migration ----

    @Test
    void theSchemaAllowsOneUnfinishedCommandPerMachineAndGuardsScopeAndReasons() throws Exception {
        var rig = rig(1, 0);
        String insert = "INSERT INTO maintenance_commands (command_code, machine_id, slot_id, operation, status, reason, note, target_inventory_item_id, requested_by, idempotency_key) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        jdbc.update(insert, "MC-a1", rig.machine(), rig.a(), "OPEN_REFILL", "SENT", null, null, null, staff.id(), "key-0000001");
        assertThatThrownBy(() -> jdbc.update(insert, "MC-a2", rig.machine(), rig.a(), "CLOSE_REFILL", "PENDING", null, null, null, staff.id(), "key-0000002"))
                .isInstanceOf(DataIntegrityViolationException.class);
        jdbc.update(insert, "MC-a3", rig.machine(), rig.a(), "CLOSE_REFILL", "FAILED", null, null, null, staff.id(), "key-0000003");
        assertThatThrownBy(() -> jdbc.update(insert, "MC-a4", rig.machine(), rig.a(), "RESET", "FAILED", null, null, null, admin.id(), "key-0000004"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(insert, "MC-a5", rig.machine(), null, "REMOVE_ITEM", "FAILED", "DAMAGED", null, head(rig.a()), staff.id(), "key-0000005"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(insert, "MC-a6", rig.machine(), rig.a(), "EMPTY_COLUMN", "FAILED", "OTHER", null, null, staff.id(), "key-0000006"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(insert, "MC-a7", rig.machine(), rig.a(), "EMPTY_COLUMN", "FAILED", null, null, null, staff.id(), "key-0000007"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(insert, "bad code", rig.machine(), rig.a(), "CLOSE_REFILL", "FAILED", null, null, null, staff.id(), "key-0000008"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(jdbc.queryForObject("SELECT refill_gate_open FROM machine_slots WHERE id = ?", Boolean.class, rig.a())).isFalse();
    }

    // ---- 9. creation rules ----

    @Test
    void creationNeedsAnOnlineMachineInMaintenanceAndAFreeController() throws Exception {
        var rig = rig(2, 0);
        jdbc.update("UPDATE machines SET status = 'ACTIVE' WHERE id = ?", rig.machine());
        assertThat(conflictCode(create(rig, rig.a(), body("OPEN_REFILL", null), "key-active-1", 409))).isEqualTo("MACHINE_NOT_IN_MAINTENANCE");
        jdbc.update("UPDATE machines SET status = 'INACTIVE' WHERE id = ?", rig.machine());
        assertThat(conflictCode(create(rig, rig.a(), body("OPEN_REFILL", null), "key-inactive", 409))).isEqualTo("MACHINE_NOT_IN_MAINTENANCE");
        jdbc.update("UPDATE machines SET status = 'MAINTENANCE', last_seen_at = ? WHERE id = ?", Timestamp.from(clock.instant().minusSeconds(600)), rig.machine());
        assertThat(conflictCode(create(rig, rig.a(), body("OPEN_REFILL", null), "key-offline", 409))).isEqualTo("MACHINE_OFFLINE");
        online(rig.machine());
        var other = rig(1, 0);
        create(rig, other.a(), body("OPEN_REFILL", null), "key-otherslot", 404);

        var first = created(rig, rig.a(), body("REMOVE_ITEM", "DAMAGED"));
        // 201 shows the command as created (PENDING); it is published right after the commit.
        assertThat(first.path("status").asText()).isEqualTo("PENDING");
        assertThat(status(first.path("commandCode").asText())).isEqualTo("SENT");
        assertThat(first.path("commandCode").asText()).matches("MC-[0-9a-f]{32}");
        assertThat(first.path("targetItem").path("inventoryItemId").asText()).isEqualTo(head(rig.a()).toString());
        assertThat(first.path("slotCode").asText()).isEqualTo("A");
        assertThat(transport.sent).containsExactly("MAINTENANCE_REMOVE_ITEM " + rig.code() + " " + first.path("commandCode").asText() + " A");
        assertThat(conflictCode(create(rig, rig.b(), body("OPEN_REFILL", null), "key-busy-0001", 409))).isEqualTo("MACHINE_COMMAND_IN_PROGRESS");

        // Validation of the request and the Idempotency-Key header.
        var free = rig(2, 0);
        for (var bad : List.<Map<String, Object>>of(body("REMOVE_ITEM", null), body("OPEN_REFILL", "DAMAGED"), body("RESET", null), body("EMPTY_COLUMN", "OTHER"),
                Map.of("operation", "REMOVE_ITEM", "reason", "DAMAGED", "extra", 1), Map.of("operation", "FLY", "reason", "DAMAGED")))
            create(free, free.a(), bad, "key-bad-" + UUID.randomUUID().toString().substring(0, 8), 400);
        create(free, free.a(), body("OPEN_REFILL", null), null, 400);
        create(free, free.a(), body("OPEN_REFILL", null), "short", 400);
        create(free, free.a(), body("OPEN_REFILL", null), "has space here", 400);
    }

    @Test
    void removeItemTakesOnlyARemovableHeadAndTheRefillGateBlocksBowlRemoval() throws Exception {
        // EXPIRED and DISPENSE_FAILED heads are removable.
        for (String state : List.of("EXPIRED", "DISPENSE_FAILED")) {
            var rig = rig(2, 0);
            jdbc.update("UPDATE inventory_items SET status = ? WHERE id = ?", state, head(rig.a()));
            created(rig, rig.a(), body("REMOVE_ITEM", "EXPIRED"));
        }
        var rig = rig(2, 0);
        UUID second = jdbc.queryForObject("SELECT id FROM inventory_items WHERE slot_id = ? ORDER BY loaded_at DESC, id DESC LIMIT 1", UUID.class, rig.a());
        var notHead = body("REMOVE_ITEM", "DAMAGED");
        notHead.put("inventoryItemId", second);
        assertThat(conflictCode(create(rig, rig.a(), notHead, "key-nothead1", 409))).isEqualTo("NOT_HEAD_ITEM");
        assertThat(conflictCode(create(rig, rig.b(), body("REMOVE_ITEM", "DAMAGED"), "key-empty-01", 409))).isEqualTo("SLOT_EMPTY");
        assertThat(conflictCode(create(rig, rig.b(), body("EMPTY_COLUMN", "INSPECTION"), "key-empty-02", 409))).isEqualTo("SLOT_EMPTY");
        jdbc.update("UPDATE inventory_items SET status = 'RESERVED', reserved_at = now() WHERE id = ?", head(rig.a()));
        assertThat(conflictCode(create(rig, rig.a(), body("EMPTY_COLUMN", "INSPECTION"), "key-reserved", 409))).isEqualTo("SLOT_HAS_RESERVED_ITEM");
        jdbc.update("UPDATE inventory_items SET status = 'AVAILABLE', reserved_at = NULL WHERE slot_id = ?", rig.a());

        jdbc.update("UPDATE machine_slots SET refill_gate_open = TRUE WHERE id = ?", rig.a());
        for (var operation : List.of(body("REMOVE_ITEM", "DAMAGED"), body("EMPTY_COLUMN", "INSPECTION"), body("OPEN_REFILL", null)))
            assertThat(conflictCode(create(rig, rig.a(), operation, "key-gate-" + operation.get("operation"), 409))).isEqualTo("REFILL_GATE_OPEN");
        created(rig, rig.a(), body("CLOSE_REFILL", null));
    }

    @Test
    void idempotencyKeysAndPermissions() throws Exception {
        var rig = rig(1, 0);
        var first = create(rig, rig.a(), body("OPEN_REFILL", null), "same-key-0001", 201).path("data");
        var again = create(rig, rig.a(), body("OPEN_REFILL", null), "same-key-0001", 200).path("data");
        assertThat(again.path("id").asText()).isEqualTo(first.path("id").asText());
        assertThat(transport.sent).hasSize(1);
        assertThat(conflictCode(create(rig, rig.a(), body("CLOSE_REFILL", null), "same-key-0001", 409))).isEqualTo("IDEMPOTENCY_KEY_REUSED");

        String reset = "/api/v1/machines/" + rig.machine() + "/reset";
        assertThat(call("POST", reset, null, staff.token(), "reset-key-01").getResponse().getStatus()).isEqualTo(403);
        assertThat(call("POST", reset, null, null, "reset-key-01").getResponse().getStatus()).isEqualTo(401);
        String key = issueKey(rig.machine());
        var kiosk = request(org.springframework.http.HttpMethod.POST, reset).header("X-Kiosk-Key", key).header("Idempotency-Key", "reset-key-01");
        assertThat(mvc.perform(kiosk).andReturn().getResponse().getStatus()).isEqualTo(401);
        assertThat(call("POST", "/api/v1/machines/" + rig.machine() + "/slots/" + rig.a() + "/maintenance-commands", body("CLOSE_REFILL", null), null, "anon-key-01")
                .getResponse().getStatus()).isEqualTo(401);
        assertThat(call("GET", "/api/v1/maintenance-commands", null, null, null).getResponse().getStatus()).isEqualTo(401);

        // List and detail.
        var list = fixtures.api("GET", "/api/v1/maintenance-commands?machineId=" + rig.machine() + "&operation=OPEN_REFILL&status=SENT", null, staff.token(), 200);
        assertThat(list.path("content")).hasSize(1);
        assertThat(list.path("content").get(0).path("id").asText()).isEqualTo(first.path("id").asText());
        assertThat(fixtures.api("GET", "/api/v1/maintenance-commands?machineId=" + rig.machine() + "&status=COMPLETED", null, staff.token(), 200)
                .path("totalElements").asLong()).isZero();
        assertThat(fixtures.api("GET", "/api/v1/maintenance-commands/" + first.path("id").asText(), null, staff.token(), 200).path("requestedBy").path("id").asText())
                .isEqualTo(staff.id().toString());
        fixtures.response("GET", "/api/v1/maintenance-commands/" + UUID.randomUUID(), null, staff.token(), 404);
        fixtures.response("GET", "/api/v1/maintenance-commands?size=101", null, staff.token(), 400);
    }

    // ---- 10. lifecycle ----

    @Test
    void busyRejectsAreResentAndTheMachinesReportsDriveTheStatus() throws Exception {
        var rig = rig(2, 0);
        var command = created(rig, rig.a(), body("REMOVE_ITEM", "DAMAGED"));
        String code = command.path("commandCode").asText();
        event(rig, "MAINTENANCE_REMOVE_ITEM_REJECTED", code, Map.of("reason", "BUSY"));
        event(rig, "MAINTENANCE_REMOVE_ITEM_REJECTED", code, Map.of("state", "HOLD_LOWER"));
        assertThat(status(code)).isEqualTo("SENT");
        clock.advance(Duration.ofSeconds(6));
        service.expireOrResend(id(command));
        assertThat(transport.sent).hasSize(2).allMatch(line -> line.endsWith(code + " A"));
        assertThat(row(code).get("attempt_count")).isEqualTo(2);

        // Ignored: wrong prefix, unknown code, another machine.
        event(rig, "MAINTENANCE_EMPTY_COLUMN_COMPLETED", code);
        event(rig, "MAINTENANCE_REMOVE_ITEM_COMPLETED", "MC-unknown");
        var other = rig(1, 0);
        event(other, "MAINTENANCE_REMOVE_ITEM_COMPLETED", code);
        assertThat(status(code)).isEqualTo("SENT");
        assertThat(present(rig.a())).isEqualTo(2);

        event(rig, "MAINTENANCE_REMOVE_ITEM_ACCEPTED", code);
        assertThat(status(code)).isEqualTo("ACCEPTED");
        event(rig, "MAINTENANCE_REMOVE_ITEM_COMPLETED", code);
        assertThat(status(code)).isEqualTo("COMPLETED");
        assertThat(present(rig.a())).isEqualTo(1);
    }

    @Test
    void timeoutsFailOrHandOverToStaffAndLateResultsApplyOnce() throws Exception {
        // Never delivered: no ACCEPTED within 30 s.
        var rig = rig(2, 0);
        transport.connected = false;
        var pending = created(rig, rig.a(), body("REMOVE_ITEM", "DAMAGED"));
        String code = pending.path("commandCode").asText();
        assertThat(status(code)).isEqualTo("PENDING");
        clock.advance(Duration.ofSeconds(31));
        service.expireOrResend(id(pending));
        assertThat(row(code)).containsEntry("status", "FAILED").containsEntry("failure_reason", "ACCEPT_TIMEOUT");
        // Accepted after giving up: the machine may be moving.
        event(rig, "MAINTENANCE_REMOVE_ITEM_ACCEPTED", code);
        assertThat(row(code)).containsEntry("status", "NEEDS_RECONCILIATION").containsEntry("failure_reason", "ACCEPTED_AFTER_TIMEOUT");
        // Late success: applied once.
        event(rig, "MAINTENANCE_REMOVE_ITEM_COMPLETED", code);
        event(rig, "MAINTENANCE_REMOVE_ITEM_COMPLETED", code);
        assertThat(status(code)).isEqualTo("COMPLETED");
        assertThat(removals(id(pending))).isEqualTo(1);

        // Accepted, no result within 90 s.
        transport.connected = true;
        online(rig.machine());
        var slow = created(rig, rig.b(), body("OPEN_REFILL", null));
        String slowCode = slow.path("commandCode").asText();
        event(rig, "MAINTENANCE_OPEN_REFILL_ACCEPTED", slowCode);
        clock.advance(Duration.ofSeconds(91));
        service.expireOrResend(id(slow));
        assertThat(row(slowCode)).containsEntry("status", "NEEDS_RECONCILIATION").containsEntry("failure_reason", "COMPLETE_TIMEOUT");
        event(rig, "MAINTENANCE_OPEN_REFILL_COMPLETED", slowCode);
        assertThat(status(slowCode)).isEqualTo("COMPLETED");
        assertThat(jdbc.queryForObject("SELECT refill_gate_open FROM machine_slots WHERE id = ?", Boolean.class, rig.b())).isTrue();

        // ABORTED and controller faults.
        var aborted = rig(1, 0);
        String abortedCode = created(aborted, aborted.a(), body("EMPTY_COLUMN", "INSPECTION")).path("commandCode").asText();
        event(aborted, "MAINTENANCE_EMPTY_COLUMN_ACCEPTED", abortedCode);
        event(aborted, "MAINTENANCE_EMPTY_COLUMN_ABORTED", abortedCode, Map.of("reason", "MANUAL_STOP"));
        assertThat(row(abortedCode)).containsEntry("status", "NEEDS_RECONCILIATION").containsEntry("failure_reason", "ABORTED_MANUAL_STOP");
        assertThat(present(aborted.a())).isEqualTo(1);
        for (Map<String, Object> fault : List.<Map<String, Object>>of(Map.of("reason", "CONTROLLER_FAULT"), Map.of("state", "FAULT"))) {
            var faulty = rig(1, 0);
            String faultCode = created(faulty, faulty.a(), body("CLOSE_REFILL", null)).path("commandCode").asText();
            event(faulty, "MAINTENANCE_CLOSE_REFILL_REJECTED", faultCode, fault);
            assertThat(row(faultCode)).as(fault.toString()).containsEntry("status", "FAILED").containsEntry("failure_reason", "CONTROLLER_FAULT");
        }
    }

    // ---- 11. effects ----

    @Test
    void removeItemRemovesOnlyTheHeadWithHistoryAndAChangedHeadIsLeftToStaff() throws Exception {
        var rig = rig(3, 0);
        UUID headBefore = head(rig.a());
        var note = body("REMOVE_ITEM", "DAMAGED");
        note.put("note", "Lid cracked");
        var command = created(rig, rig.a(), note);
        String code = command.path("commandCode").asText();
        event(rig, "MAINTENANCE_REMOVE_ITEM_ACCEPTED", code);
        event(rig, "MAINTENANCE_REMOVE_ITEM_COMPLETED", code);
        event(rig, "MAINTENANCE_REMOVE_ITEM_COMPLETED", code);
        assertThat(jdbc.queryForObject("SELECT status FROM inventory_items WHERE id = ?", String.class, headBefore)).isEqualTo("REMOVED");
        assertThat(present(rig.a())).isEqualTo(2);
        var history = jdbc.queryForMap("SELECT * FROM inventory_transactions WHERE type = 'REMOVE' AND reference_id = ?", id(command));
        assertThat(history).containsEntry("inventory_item_id", headBefore).containsEntry("performed_by", staff.id())
                .containsEntry("reason", "MAINTENANCE_REMOVE_ITEM DAMAGED: Lid cracked").containsEntry("status_before", "AVAILABLE")
                .containsEntry("status_after", "REMOVED").containsEntry("slot_id", rig.a());
        assertThat(removals(id(command))).isEqualTo(1);
        assertThat(row(code).get("removed_count")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT quantity FROM product_batches b JOIN inventory_items i ON i.batch_id = b.id WHERE i.id = ?", Integer.class, headBefore))
                .isEqualTo(3);

        // The head changed before the machine finished (removed by hand): nothing removed, Staff decides.
        online(rig.machine());
        var changed = created(rig, rig.a(), body("REMOVE_ITEM", "EXPIRED"));
        UUID target = UUID.fromString(changed.path("targetItem").path("inventoryItemId").asText());
        jdbc.update("UPDATE inventory_items SET status = 'REMOVED', removed_at = GREATEST(now(), loaded_at) WHERE id = ?", target);
        event(rig, "MAINTENANCE_REMOVE_ITEM_COMPLETED", changed.path("commandCode").asText());
        assertThat(row(changed.path("commandCode").asText())).containsEntry("status", "NEEDS_RECONCILIATION").containsEntry("failure_reason", "HEAD_CHANGED");
        assertThat(removals(id(changed))).isZero();
        assertThat(present(rig.a())).isEqualTo(1);
        // DONE is no longer possible; NOT_DONE closes it.
        var reconcile = "/api/v1/maintenance-commands/" + id(changed) + "/reconcile";
        assertThat(conflictCode(fixtures.response("POST", reconcile, Map.of("outcome", "DONE"), staff.token(), 409))).isEqualTo("EFFECT_NOT_POSSIBLE");
        assertThat(fixtures.api("POST", reconcile, Map.of("outcome", "NOT_DONE", "note", "Removed by hand"), staff.token(), 200).path("status").asText())
                .isEqualTo("RECONCILED");
    }

    @Test
    void aBowlLeftByAFailedDispenseIsRemovedWithoutTouchingTheOrder() throws Exception {
        PlacedOrder order = placeOrder();
        pay(order, 201);
        assertThat(paid(referenceOf(order.orderId()), "TXN-" + order.orderId(), orderTotal(order.orderId()))).isEqualTo(200);
        String machineCode = codeOf(order.shop().machineId());
        String dispenseCode = jdbc.queryForObject("SELECT command_code FROM dispense_commands WHERE order_id = ?", String.class, order.orderId());
        dispense.handleMachineEvent(machineCode, DispenseService.EVENT_ABORTED, dispenseCode);
        assertThat(jdbc.queryForObject("SELECT status FROM machines WHERE id = ?", String.class, order.shop().machineId())).isEqualTo("MAINTENANCE");
        UUID failed = jdbc.queryForObject("SELECT inventory_item_id FROM dispense_commands WHERE order_id = ?", UUID.class, order.orderId());
        online(order.shop().machineId());
        var rig = new Rig(order.shop().machineId(), machineCode, order.shop().slotId(), null, order.shop().productId());
        var command = created(rig, rig.a(), body("REMOVE_ITEM", "DISPENSE_FAILED"));
        assertThat(command.path("targetItem").path("inventoryItemId").asText()).isEqualTo(failed.toString());
        event(rig, "MAINTENANCE_REMOVE_ITEM_COMPLETED", command.path("commandCode").asText());
        assertThat(jdbc.queryForObject("SELECT status FROM inventory_items WHERE id = ?", String.class, failed)).isEqualTo("REMOVED");
        assertThat(orderStatus(order.orderId())).isEqualTo("DISPENSE_FAILED");
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1", String.class, order.orderId()))
                .isEqualTo("SUCCESS");
    }

    @Test
    void emptyColumnRemovesEveryPresentBowlAndTheRefillGateStopsSales() throws Exception {
        var rig = rig(5, 1);
        List<UUID> bowls = jdbc.queryForList("SELECT id FROM inventory_items WHERE slot_id = ? ORDER BY loaded_at, id", UUID.class, rig.a());
        jdbc.update("UPDATE inventory_items SET status = 'EXPIRED' WHERE id = ?", bowls.get(1));
        jdbc.update("UPDATE inventory_items SET status = 'DISPENSE_FAILED' WHERE id = ?", bowls.get(2));
        jdbc.update("UPDATE inventory_items SET status = 'SOLD', sold_at = GREATEST(now(), loaded_at) WHERE id = ?", bowls.get(3));
        jdbc.update("UPDATE inventory_items SET status = 'REMOVED', removed_at = GREATEST(now(), loaded_at) WHERE id = ?", bowls.get(4));
        var command = created(rig, rig.a(), body("EMPTY_COLUMN", "EXPIRED"));
        event(rig, "MAINTENANCE_EMPTY_COLUMN_COMPLETED", command.path("commandCode").asText());
        assertThat(row(command.path("commandCode").asText()).get("removed_count")).isEqualTo(3);
        assertThat(removals(id(command))).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT status FROM inventory_items WHERE id = ?", String.class, bowls.get(3))).isEqualTo("SOLD");
        assertThat(present(rig.a())).isZero();
        assertThat(present(rig.b())).isEqualTo(1);

        // Open the refill gate of B: B stops selling and cannot be activated; closing it restores both.
        jdbc.update("UPDATE machine_slots SET status = 'INACTIVE' WHERE id = ?", rig.b());
        online(rig.machine());
        var open = created(rig, rig.b(), body("OPEN_REFILL", null));
        event(rig, "MAINTENANCE_OPEN_REFILL_COMPLETED", open.path("commandCode").asText());
        assertThat(fixtures.api("GET", "/api/v1/machines/" + rig.machine() + "/slots/" + rig.b(), null, staff.token(), 200).path("refillGateOpen").asBoolean()).isTrue();
        assertThat(conflictCode(fixtures.response("PATCH", "/api/v1/machines/" + rig.machine() + "/slots/" + rig.b() + "/status", Map.of("status", "ACTIVE"),
                admin.token(), 409))).isEqualTo("REFILL_GATE_OPEN");
        jdbc.update("UPDATE machine_slots SET status = 'ACTIVE' WHERE id = ?", rig.b());
        jdbc.update("UPDATE machines SET status = 'ACTIVE' WHERE id = ?", rig.machine());
        String kiosk = issueKey(rig.machine());
        assertThat(kioskData("GET", "/api/v1/kiosk/catalog", kiosk, null, 200).path("products")).isEmpty();
        kioskJson("POST", "/api/v1/kiosk/orders", kiosk, orderBody(rig.product()), 409);

        jdbc.update("UPDATE machines SET status = 'MAINTENANCE' WHERE id = ?", rig.machine());
        online(rig.machine());
        var close = created(rig, rig.b(), body("CLOSE_REFILL", null));
        event(rig, "MAINTENANCE_CLOSE_REFILL_COMPLETED", close.path("commandCode").asText());
        jdbc.update("UPDATE machines SET status = 'ACTIVE' WHERE id = ?", rig.machine());
        assertThat(kioskData("GET", "/api/v1/kiosk/catalog", kiosk, null, 200).path("products")).hasSize(1);
    }

    @Test
    void dispensingWaitsForAnUnfinishedMaintenanceCommand() throws Exception {
        transport.connected = false;
        PlacedOrder order = placeOrder();
        pay(order, 201);
        assertThat(paid(referenceOf(order.orderId()), "TXN-" + order.orderId(), orderTotal(order.orderId()))).isEqualTo(200);
        UUID dispenseId = jdbc.queryForObject("SELECT id FROM dispense_commands WHERE order_id = ?", UUID.class, order.orderId());
        assertThat(jdbc.queryForObject("SELECT status FROM dispense_commands WHERE id = ?", String.class, dispenseId)).isEqualTo("PENDING");
        jdbc.update("INSERT INTO maintenance_commands (command_code, machine_id, slot_id, operation, status, requested_by, idempotency_key) "
                + "VALUES ('MC-blocking', ?, ?, 'CLOSE_REFILL', 'SENT', ?, 'blocking-key')", order.shop().machineId(), order.shop().slotId(), staff.id());
        transport.connected = true;
        clock.advance(Duration.ofSeconds(6));
        dispense.expireOrResend(dispenseId);
        assertThat(jdbc.queryForObject("SELECT status FROM dispense_commands WHERE id = ?", String.class, dispenseId)).isEqualTo("PENDING");
        assertThat(transport.sent).isEmpty();
        jdbc.update("UPDATE maintenance_commands SET status = 'FAILED', finished_at = now() WHERE command_code = 'MC-blocking'");
        dispense.expireOrResend(dispenseId);
        assertThat(jdbc.queryForObject("SELECT status FROM dispense_commands WHERE id = ?", String.class, dispenseId)).isEqualTo("SENT");

        // And a running dispense blocks maintenance.
        jdbc.update("UPDATE machines SET status = 'MAINTENANCE' WHERE id = ?", order.shop().machineId());
        online(order.shop().machineId());
        var rig = new Rig(order.shop().machineId(), codeOf(order.shop().machineId()), order.shop().slotId(), null, order.shop().productId());
        jdbc.update("UPDATE inventory_items SET status = 'AVAILABLE' WHERE status = 'RESERVED' AND slot_id = ?", rig.a());
        assertThat(conflictCode(create(rig, rig.a(), body("CLOSE_REFILL", null), "key-dispensing", 409))).isEqualTo("MACHINE_COMMAND_IN_PROGRESS");
    }

    // ---- 12. reconciliation and RESET ----

    @Test
    void staffReconcilesUncertainCommandsOnceAndAdminResetsTheController() throws Exception {
        var rig = rig(3, 0);
        var done = created(rig, rig.a(), body("EMPTY_COLUMN", "INSPECTION"));
        event(rig, "MAINTENANCE_EMPTY_COLUMN_ABORTED", done.path("commandCode").asText());
        String path = "/api/v1/maintenance-commands/" + id(done) + "/reconcile";
        var reconciled = fixtures.api("POST", path, Map.of("outcome", "DONE", "note", "Column checked: empty"), staff.token(), 200);
        assertThat(reconciled.path("status").asText()).isEqualTo("RECONCILED");
        assertThat(reconciled.path("reconciliationOutcome").asText()).isEqualTo("DONE");
        assertThat(reconciled.path("reconciledBy").path("id").asText()).isEqualTo(staff.id().toString());
        assertThat(reconciled.path("removedCount").asInt()).isEqualTo(3);
        assertThat(present(rig.a())).isZero();
        assertThat(conflictCode(fixtures.response("POST", path, Map.of("outcome", "NOT_DONE"), staff.token(), 409))).isEqualTo("NOT_RECONCILABLE");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_logs WHERE action = 'MAINTENANCE_COMMAND_RECONCILED' AND entity_id = ?", Long.class, id(done)))
                .isEqualTo(1);

        online(rig.machine());
        var notDone = created(rig, rig.b(), body("OPEN_REFILL", null));
        event(rig, "MAINTENANCE_OPEN_REFILL_ABORTED", notDone.path("commandCode").asText());
        fixtures.api("POST", "/api/v1/maintenance-commands/" + id(notDone) + "/reconcile", Map.of("outcome", "NOT_DONE"), staff.token(), 200);
        assertThat(jdbc.queryForObject("SELECT refill_gate_open FROM machine_slots WHERE id = ?", Boolean.class, rig.b())).isFalse();
        fixtures.response("POST", "/api/v1/maintenance-commands/" + id(notDone) + "/reconcile", Map.of("outcome", "MAYBE"), staff.token(), 400);

        // RESET: Admin only, accepted = done; FAULT_CLEARED resolves the CONTROLLER_FAULT alert, the machine stays MAINTENANCE.
        online(rig.machine());
        event(rig, "FAULT", null, Map.of("code", "CONTROLLER_FAULT"));
        var resetResult = call("POST", "/api/v1/machines/" + rig.machine() + "/reset", Map.of("note", "Gates checked"), admin.token(), "reset-key-0001");
        assertThat(resetResult.getResponse().getStatus()).isEqualTo(201);
        var reset = json.readTree(resetResult.getResponse().getContentAsString()).path("data");
        assertThat(reset.path("operation").asText()).isEqualTo("RESET");
        assertThat(reset.path("slotId").isNull()).isTrue();
        String resetCode = reset.path("commandCode").asText();
        assertThat(transport.sent).contains("RESET " + rig.code() + " " + resetCode);
        event(rig, "RESET_ACCEPTED", resetCode);
        assertThat(status(resetCode)).isEqualTo("COMPLETED");
        event(rig, "FAULT_CLEARED", null, Map.of("code", "CONTROLLER_FAULT"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM alerts WHERE machine_id = ? AND error_code = 'CONTROLLER_FAULT' AND status <> 'RESOLVED'",
                Long.class, rig.machine())).isZero();
        assertThat(jdbc.queryForObject("SELECT status FROM machines WHERE id = ?", String.class, rig.machine())).isEqualTo("MAINTENANCE");
        assertThat(conflictCode(fixtures.response("POST", "/api/v1/maintenance-commands/" + reset.path("id").asText() + "/reconcile",
                Map.of("outcome", "DONE"), staff.token(), 409))).isEqualTo("NOT_RECONCILABLE");
    }

    @Test
    void theContractExampleHasTheKeysTheBackendPublishes() throws Exception {
        JsonNode example = json.readTree(Files.readString(Path.of("../api-contract/mqtt/examples/command-maintenance-remove-item.json"), StandardCharsets.UTF_8));
        JsonNode produced = json.valueToTree(MachineCommands.maintenance("FV-DEV-001", "MAINTENANCE_REMOVE_ITEM", "MC-x", "A"));
        List<String> exampleKeys = new ArrayList<>(), producedKeys = new ArrayList<>();
        example.path("payload").fieldNames().forEachRemaining(exampleKeys::add);
        produced.path("payload").fieldNames().forEachRemaining(producedKeys::add);
        assertThat(producedKeys).containsExactlyInAnyOrderElementsOf(exampleKeys);
        assertThat(json.valueToTree(MachineCommands.reset("FV-DEV-001", "MC-y")).path("payload").fieldNames()).toIterable()
                .containsExactlyInAnyOrder("type", "commandId");
        assertThatThrownBy(() -> MachineCommands.maintenance("FV-DEV-001", "DISPENSE", "MC-z", "A")).isInstanceOf(IllegalArgumentException.class);
    }
}
