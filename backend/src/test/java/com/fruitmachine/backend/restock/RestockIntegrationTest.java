package com.fruitmachine.backend.restock;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.alert.enums.AlertSeverity;
import com.fruitmachine.backend.alert.enums.AlertType;
import com.fruitmachine.backend.alert.service.AlertService;
import com.fruitmachine.backend.alert.service.AlertSpec;
import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.maintenance.service.MaintenanceCommandService;
import com.fruitmachine.backend.maintenance.service.MaintenanceReport;
import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import com.fruitmachine.backend.support.TestDataFactory;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Issue #68 §7–§12: restock suggestions, planning, loading, removal link and completion on real PostgreSQL. */
class RestockIntegrationTest extends AbstractWebhookIntegrationTest {
    @Autowired AlertService alertService;
    @Autowired MaintenanceCommandService maintenance;
    @Autowired BusinessCalendar calendar;
    @Autowired TransactionTemplate transactions;

    // ---- helpers ----

    record Rig(UUID machine, String code, UUID a, UUID b, UUID product) { }

    Rig rig(int capacityA, int capacityB) throws Exception {
        UUID machine = fixtures.machine(admin.token());
        UUID product = createProduct("Dưa hấu", "35000");
        return new Rig(machine, jdbc.queryForObject("SELECT code FROM machines WHERE id = ?", String.class, machine),
                createSlot(machine, "A", capacityA), createSlot(machine, "B", capacityB), product);
    }

    UUID batch(UUID product, int quantity, Instant expiresAt) throws Exception {
        return TestDataFactory.id(fixtures.api("POST", "/api/v1/product-batches", Map.of("batchCode", "RS-" + UUID.randomUUID(), "productId", product,
                "manufacturedAt", Instant.now().minus(Duration.ofHours(2)).truncatedTo(ChronoUnit.SECONDS).toString(),
                "expiresAt", expiresAt.truncatedTo(ChronoUnit.SECONDS).toString(), "quantity", quantity), staff.token(), 201));
    }

    UUID batch(UUID product, int quantity, int days) throws Exception {
        return batch(product, quantity, clock.instant().plus(Duration.ofDays(days)));
    }

    /** Expires later today (business zone), at least 30 minutes from now. */
    Instant laterToday() {
        Instant now = clock.instant();
        Instant midnight = calendar.dayEnd(calendar.today(now));
        if (Duration.between(now, midnight).compareTo(Duration.ofMinutes(30)) < 0) clock.advance(Duration.between(now, midnight).plusHours(1));
        return calendar.dayEnd(calendar.today(clock.instant())).minus(Duration.ofMinutes(10));
    }

    JsonNode suggestion(UUID machine, String slotCode) throws Exception {
        for (JsonNode slot : fixtures.api("GET", "/api/v1/machines/" + machine + "/restock-suggestions", null, admin.token(), 200).path("slots"))
            if (slot.path("slotCode").asText().equals(slotCode)) return slot;
        throw new AssertionError(slotCode);
    }

    Map<String, Object> line(UUID slot, UUID product, int planned) {
        return Map.of("slotId", slot, "productId", product, "plannedQuantity", planned);
    }

    JsonNode restockOrder(Rig rig, UUID assignee, List<Map<String, Object>> lines) throws Exception {
        var body = new HashMap<String, Object>();
        body.put("type", "RESTOCK");
        body.put("machineId", rig.machine());
        body.put("title", "Nạp hàng");
        if (assignee != null) body.put("assigneeId", assignee);
        body.put("restockLines", lines);
        return fixtures.api("POST", "/api/v1/work-orders", body, admin.token(), 201);
    }

    String wo(JsonNode order, String action) {
        return "/api/v1/work-orders/" + order.path("id").asText() + (action == null ? "" : "/" + action);
    }

    List<JsonNode> lines(JsonNode order) throws Exception {
        var out = new ArrayList<JsonNode>();
        fixtures.api("GET", wo(order, "restock"), null, admin.token(), 200).path("lines").forEach(out::add);
        return out;
    }

    String loads(JsonNode order, JsonNode line) {
        return wo(order, "restock-lines/" + line.path("id").asText() + "/loads");
    }

    String conflictCode(JsonNode error) {
        return error.path("message").asText().split(":")[0];
    }

    void online(UUID machine) {
        jdbc.update("UPDATE machines SET last_seen_at = ?, last_offline_at = NULL WHERE id = ?", Timestamp.from(clock.instant()), machine);
    }

    UUID raiseSlotAlert(Rig rig, UUID slot, AlertType type) {
        String key = AlertSpec.slotKey(type, slot);
        transactions.executeWithoutResult(s -> alertService.raise(new AlertSpec(type, AlertSeverity.WARNING, rig.machine(), slot, null, key, "Alert " + type, "Test"),
                clock.instant().truncatedTo(ChronoUnit.MICROS)));
        return jdbc.queryForObject("SELECT id FROM alerts WHERE dedupe_key = ? AND status <> 'RESOLVED'", UUID.class, key);
    }

    // ---- 7. migration ----

    @Test
    void theSchemaRejectsDuplicateLinesAndSlotsOfAnotherMachine() throws Exception {
        var rig = rig(6, 6);
        var other = rig(6, 6);
        var order = restockOrder(rig, null, List.of(line(rig.a(), rig.product(), 3)));
        UUID id = UUID.fromString(order.path("id").asText());
        String insert = "INSERT INTO restock_lines (work_order_id, machine_id, slot_id, product_id, planned_quantity) VALUES (?, ?, ?, ?, 1)";
        assertThatThrownBy(() -> jdbc.update(insert, id, rig.machine(), rig.a(), rig.product())).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(insert, id, rig.machine(), other.a(), rig.product())).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE restock_lines SET planned_quantity = 1001 WHERE work_order_id = ?", id)).isInstanceOf(DataIntegrityViolationException.class);
    }

    // ---- 8. suggestions ----

    @Test
    void suggestionsFollowTheColumnState() throws Exception {
        var healthy = rig(4, 6);
        load(batch(healthy.product(), 6, 3), healthy.a(), 4);
        load(batch(healthy.product(), 2, 3), healthy.b(), 2);
        UUID lowAlert = raiseSlotAlert(healthy, healthy.b(), AlertType.LOW_STOCK);
        var full = suggestion(healthy.machine(), "A");
        assertThat(full.path("suggestedAction").asText()).isEqualTo("NONE");
        assertThat(full.path("suggestedLoadQuantity").asInt()).isZero();
        assertThat(full.path("sellableCount").asLong()).isEqualTo(4);
        var low = suggestion(healthy.machine(), "B");
        assertThat(low.path("suggestedAction").asText()).isEqualTo("LOAD");
        assertThat(low.path("suggestedLoadQuantity").asInt()).isEqualTo(4);
        assertThat(low.path("currentProduct").path("name").asText()).isEqualTo("Dưa hấu");
        assertThat(low.path("openAlerts").toString()).contains("LOW_STOCK");
        assertThat(lowAlert).isNotNull();

        var bad = rig(6, 6);
        load(batch(bad.product(), 3, 3), bad.a(), 3);
        jdbc.update("UPDATE inventory_items SET status = 'EXPIRED' WHERE id = (SELECT id FROM inventory_items WHERE slot_id = ? ORDER BY loaded_at DESC LIMIT 1)", bad.a());
        var expired = suggestion(bad.machine(), "A");
        assertThat(expired.path("suggestedAction").asText()).isEqualTo("EMPTY_THEN_LOAD");
        assertThat(expired.path("suggestedLoadQuantity").asInt()).isEqualTo(6);
        assertThat(expired.path("expiredCount").asLong()).isEqualTo(1);
        var empty = suggestion(bad.machine(), "B");
        assertThat(empty.path("currentProduct").isNull()).isTrue();
        assertThat(empty.path("physicalCount").asLong()).isZero();
        assertThat(empty.path("suggestedAction").asText()).isEqualTo("LOAD");

        var blocked = rig(6, 6);
        load(batch(blocked.product(), 2, 3), blocked.a(), 2);
        jdbc.update("UPDATE inventory_items SET status = 'DISPENSE_FAILED' WHERE id = (SELECT id FROM inventory_items WHERE slot_id = ? ORDER BY loaded_at, id LIMIT 1)", blocked.a());
        var failed = suggestion(blocked.machine(), "A");
        assertThat(failed.path("suggestedAction").asText()).isEqualTo("EMPTY_THEN_LOAD");
        assertThat(failed.path("headStatus").asText()).isEqualTo("DISPENSE_FAILED");
        assertThat(failed.path("sellableCount").asLong()).isZero();
        load(batch(blocked.product(), 1, laterToday()), blocked.b(), 1);
        var today = suggestion(blocked.machine(), "B");
        assertThat(today.path("expiringTodayCount").asLong()).isEqualTo(1);
        assertThat(today.path("suggestedAction").asText()).isEqualTo("EMPTY_THEN_LOAD");

        fixtures.response("GET", "/api/v1/machines/" + blocked.machine() + "/restock-suggestions", null, staff.token(), 403);
        fixtures.response("GET", "/api/v1/machines/" + UUID.randomUUID() + "/restock-suggestions", null, admin.token(), 404);
    }

    // ---- 9. planning ----

    @Test
    void planningValidatesLinesAndCreatesFromSuggestions() throws Exception {
        var rig = rig(6, 4);
        load(batch(rig.product(), 2, 3), rig.a(), 2);
        UUID lowAlert = raiseSlotAlert(rig, rig.a(), AlertType.LOW_STOCK);
        var fromSuggestions = fixtures.api("POST", "/api/v1/machines/" + rig.machine() + "/restock-work-orders",
                Map.of("fromSuggestions", true, "assigneeId", staff.id()), admin.token(), 201);
        assertThat(fromSuggestions.path("type").asText()).isEqualTo("RESTOCK");
        assertThat(fromSuggestions.path("status").asText()).isEqualTo("ASSIGNED");
        assertThat(fromSuggestions.path("restockSummary").path("lines").asInt()).isEqualTo(1);
        assertThat(fromSuggestions.path("restockSummary").path("plannedTotal").asInt()).isEqualTo(4);
        assertThat(fromSuggestions.path("linkedAlerts").findValuesAsText("id")).containsExactly(lowAlert.toString());
        var planned = lines(fromSuggestions);
        assertThat(planned).hasSize(1);
        assertThat(planned.getFirst().path("slotCode").asText()).isEqualTo("A");
        assertThat(conflictCode(fixtures.response("POST", "/api/v1/machines/" + rig(6, 6).machine() + "/restock-work-orders", Map.of("fromSuggestions", true),
                admin.token(), 409))).isEqualTo("NOTHING_TO_RESTOCK");

        var manual = restockOrder(rig, null, List.of(line(rig.b(), rig.product(), 4)));
        fixtures.response("POST", wo(manual, "restock-lines"), line(rig.b(), rig.product(), 1), admin.token(), 409);
        fixtures.response("POST", wo(manual, "restock-lines"), line(rig.a(), rig.product(), 7), admin.token(), 400);
        fixtures.response("POST", wo(manual, "restock-lines"), line(rig(6, 6).a(), rig.product(), 1), admin.token(), 400);
        UUID inactive = createProduct("Ngừng bán", "20000");
        jdbc.update("UPDATE products SET status = 'INACTIVE' WHERE id = ?", inactive);
        assertThat(conflictCode(fixtures.response("POST", wo(manual, "restock-lines"), line(rig.a(), inactive, 1), admin.token(), 409))).isEqualTo("PRODUCT_INACTIVE");
        var added = fixtures.api("POST", wo(manual, "restock-lines"), line(rig.a(), rig.product(), 2), admin.token(), 201);
        var changed = fixtures.api("PATCH", wo(manual, "restock-lines/" + added.path("id").asText()), Map.of("plannedQuantity", 3), admin.token(), 200);
        assertThat(changed.path("plannedQuantity").asInt()).isEqualTo(3);
        fixtures.api("DELETE", wo(manual, "restock-lines/" + added.path("id").asText()), null, admin.token(), 200);
        fixtures.response("POST", wo(manual, "restock-lines"), line(rig.a(), rig.product(), 1), staff.token(), 403);

        // Other types: no lines.
        var maintenance = fixtures.api("POST", "/api/v1/work-orders", Map.of("type", "MAINTENANCE", "machineId", rig.machine(), "title", "Servo"), admin.token(), 201);
        fixtures.response("POST", wo(maintenance, "restock-lines"), line(rig.a(), rig.product(), 1), admin.token(), 400);
        fixtures.response("POST", "/api/v1/work-orders", Map.of("type", "MAINTENANCE", "machineId", rig.machine(), "title", "x",
                "restockLines", List.of(line(rig.a(), rig.product(), 1))), admin.token(), 400);

        // A RESTOCK work order needs lines to start.
        var noLines = restockOrder(rig, staff.id(), List.of());
        assertThat(conflictCode(fixtures.response("POST", wo(noLines, "start"), null, staff.token(), 409))).isEqualTo("RESTOCK_WITHOUT_LINES");
    }

    // ---- 10. loading ----

    @Test
    void theAssigneeLoadsAgainstALineWithFifoAndExpiryRules() throws Exception {
        var rig = rig(6, 6);
        var order = restockOrder(rig, staff.id(), List.of(line(rig.a(), rig.product(), 6)));
        var planLine = lines(order).getFirst();
        UUID good = batch(rig.product(), 20, 5);
        assertThat(conflictCode(fixtures.response("POST", loads(order, planLine), Map.of("batchId", good, "quantity", 2), staff.token(), 409)))
                .isEqualTo("WORK_ORDER_NOT_IN_PROGRESS");
        fixtures.api("POST", wo(order, "start"), null, staff.token(), 200);
        assertThat(jdbc.queryForObject("SELECT status FROM machines WHERE id = ?", String.class, rig.machine())).isEqualTo("MAINTENANCE");
        var other = fixtures.staff(admin.token(), PASSWORD);
        fixtures.response("POST", loads(order, planLine), Map.of("batchId", good, "quantity", 2), other.token(), 404);

        var loaded = fixtures.api("POST", loads(order, planLine), Map.of("batchId", good, "quantity", 2), staff.token(), 201);
        assertThat(loaded.path("loaded").asInt()).isEqualTo(2);
        assertThat(loaded.path("line").path("loadedQuantity").asInt()).isEqualTo(2);
        UUID lineId = UUID.fromString(planLine.path("id").asText());
        var history = jdbc.queryForList("SELECT reference_id, performed_by, reason, type FROM inventory_transactions WHERE reference_id = ?", lineId);
        assertThat(history).hasSize(2).allSatisfy(row -> {
            assertThat(row.get("performed_by")).isEqualTo(staff.id());
            assertThat(row.get("type")).isEqualTo("LOAD");
            assertThat((String) row.get("reason")).startsWith("Restock WO-");
        });
        var times = jdbc.queryForList("SELECT loaded_at FROM inventory_items WHERE slot_id = ? ORDER BY loaded_at, id", Timestamp.class, rig.a());
        assertThat(times.get(1).toInstant()).isAfter(times.get(0).toInstant());
        UUID firstLoaded = UUID.fromString(loaded.path("inventoryItemIds").get(0).asText());
        assertThat(jdbc.queryForObject("SELECT id FROM inventory_items WHERE slot_id = ? ORDER BY loaded_at, id LIMIT 1", UUID.class, rig.a())).isEqualTo(firstLoaded);

        // Rules.
        UUID otherProduct = batch(createProduct("Xoài", "30000"), 5, 5);
        assertThat(conflictCode(fixtures.response("POST", loads(order, planLine), Map.of("batchId", otherProduct, "quantity", 1), staff.token(), 409)))
                .isEqualTo("BATCH_PRODUCT_MISMATCH");
        UUID shortLived = batch(rig.product(), 5, clock.instant().plusSeconds(120));
        assertThat(conflictCode(fixtures.response("POST", loads(order, planLine), Map.of("batchId", shortLived, "quantity", 1), staff.token(), 409)))
                .isEqualTo("BATCH_EXPIRED");
        UUID earlier = batch(rig.product(), 5, 2);
        var inversion = fixtures.response("POST", loads(order, planLine), Map.of("batchId", earlier, "quantity", 1), staff.token(), 409);
        assertThat(conflictCode(inversion)).isEqualTo("EXPIRY_INVERSION");
        assertThat(inversion.path("message").asText()).contains(firstLoaded.toString());
        fixtures.api("POST", loads(order, planLine), Map.of("batchId", earlier, "quantity", 1, "acknowledgeExpiryInversion", true), staff.token(), 201);
        UUID tiny = batch(rig.product(), 1, 5);
        fixtures.api("POST", loads(order, planLine), Map.of("batchId", tiny, "quantity", 1), staff.token(), 201);
        assertThat(conflictCode(fixtures.response("POST", loads(order, planLine), Map.of("batchId", tiny, "quantity", 1), staff.token(), 409)))
                .isEqualTo("BATCH_QUANTITY_EXCEEDED");
        assertThat(conflictCode(fixtures.response("POST", loads(order, planLine), Map.of("batchId", good, "quantity", 3, "acknowledgeExpiryInversion", true),
                staff.token(), 409))).isEqualTo("SLOT_CAPACITY_EXCEEDED");
        fixtures.response("POST", loads(order, planLine), Map.of("batchId", good, "quantity", 1.5), staff.token(), 400);

        // ERROR slots can be loaded (that is how they are fixed); INACTIVE cannot.
        var second = fixtures.api("POST", wo(order, "restock-lines"), line(rig.b(), rig.product(), 4), admin.token(), 201);
        jdbc.update("UPDATE machine_slots SET status = 'ERROR' WHERE id = ?", rig.b());
        fixtures.api("POST", loads(order, second), Map.of("batchId", good, "quantity", 1), staff.token(), 201);
        jdbc.update("UPDATE machine_slots SET status = 'INACTIVE' WHERE id = ?", rig.b());
        assertThat(conflictCode(fixtures.response("POST", loads(order, second), Map.of("batchId", good, "quantity", 1), staff.token(), 409))).isEqualTo("SLOT_INACTIVE");
        // A loaded line cannot be changed or deleted.
        assertThat(conflictCode(fixtures.response("PATCH", wo(order, "restock-lines/" + planLine.path("id").asText()), Map.of("plannedQuantity", 5), admin.token(), 409)))
                .isEqualTo("LINE_ALREADY_LOADED");
        fixtures.response("DELETE", wo(order, "restock-lines/" + planLine.path("id").asText()), null, admin.token(), 409);
        // Direct loading is ADMIN only.
        fixtures.response("POST", "/api/v1/inventory/load", TestDataFactory.loadBody(good, rig.a(), 1), staff.token(), 403);
    }

    @Test
    void concurrentLoadsIntoOneColumnNeverExceedItsCapacity() throws Exception {
        var rig = rig(4, 4);
        var order = restockOrder(rig, staff.id(), List.of(line(rig.a(), rig.product(), 4)));
        fixtures.api("POST", wo(order, "start"), null, staff.token(), 200);
        var planLine = lines(order).getFirst();
        UUID good = batch(rig.product(), 20, 5);
        List<Callable<Integer>> tasks = new ArrayList<>();
        for (int i = 0; i < 4; i++) tasks.add(() -> mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(loads(order, planLine))
                .header("Authorization", "Bearer " + staff.token()).contentType("application/json")
                .content(json.writeValueAsString(Map.of("batchId", good, "quantity", 2)))).andReturn().getResponse().getStatus());
        var statuses = parallel(tasks);
        assertThat(statuses.stream().filter(s -> s == 201).count()).isEqualTo(2);
        assertThat(statuses.stream().filter(s -> s == 409).count()).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE slot_id = ?", Long.class, rig.a())).isEqualTo(4);
        assertThat(jdbc.queryForObject("SELECT loaded_quantity FROM restock_lines WHERE id = ?", Integer.class, UUID.fromString(planLine.path("id").asText())))
                .isEqualTo(4);
    }

    // ---- 11. removal link, 12. completion ----

    JsonNode maintenanceCommand(Rig rig, UUID slot, Map<String, Object> body, int expected) throws Exception {
        var result = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .post("/api/v1/machines/" + rig.machine() + "/slots/" + slot + "/maintenance-commands")
                .header("Authorization", "Bearer " + staff.token()).header("Idempotency-Key", "rs-" + UUID.randomUUID().toString().substring(0, 12))
                .contentType("application/json").content(json.writeValueAsString(body))).andReturn();
        assertThat(result.getResponse().getStatus()).as(result.getResponse().getContentAsString()).isEqualTo(expected);
        return json.readTree(result.getResponse().getContentAsString());
    }

    @Test
    void removalThroughLinkedMaintenanceAndCompletionReconcilePlannedAndLoaded() throws Exception {
        var rig = rig(6, 6);
        load(batch(rig.product(), 2, 3), rig.a(), 2);
        jdbc.update("UPDATE inventory_items SET status = 'EXPIRED' WHERE slot_id = ?", rig.a());
        UUID lowB = raiseSlotAlert(rig, rig.b(), AlertType.LOW_STOCK);
        var order = restockOrder(rig, staff.id(), List.of(line(rig.a(), rig.product(), 6), line(rig.b(), rig.product(), 3)));
        String woId = order.path("id").asText();
        online(rig.machine());
        jdbc.update("UPDATE machines SET status = 'MAINTENANCE' WHERE id = ?", rig.machine());
        var empty = Map.<String, Object>of("operation", "EMPTY_COLUMN", "reason", "EXPIRED", "workOrderId", woId);
        assertThat(conflictCode(maintenanceCommand(rig, rig.a(), empty, 409))).isEqualTo("WORK_ORDER_NOT_IN_PROGRESS");
        fixtures.api("POST", wo(order, "start"), null, staff.token(), 200);
        var elsewhere = rig(6, 6);
        online(elsewhere.machine());
        jdbc.update("UPDATE machines SET status = 'MAINTENANCE' WHERE id = ?", elsewhere.machine());
        assertThat(conflictCode(maintenanceCommand(elsewhere, elsewhere.a(), Map.of("operation", "OPEN_REFILL", "workOrderId", woId), 409)))
                .isEqualTo("WORK_ORDER_OTHER_MACHINE");

        var command = maintenanceCommand(rig, rig.a(), empty, 201).path("data");
        assertThat(command.path("workOrderId").asText()).isEqualTo(woId);
        maintenance.handleMachineEvent(rig.code(), new MaintenanceReport("MAINTENANCE_EMPTY_COLUMN_COMPLETED", command.path("commandCode").asText(), null, null));
        var view = fixtures.api("GET", wo(order, "restock"), null, staff.token(), 200);
        assertThat(view.path("removedByReason").path("EXPIRED").asInt()).isEqualTo(2);
        assertThat(view.path("maintenanceCommands")).hasSize(1);

        var planned = lines(order);
        var lineA = planned.get(0);
        var lineB = planned.get(1);
        UUID batch = batch(rig.product(), 20, 5);
        fixtures.api("POST", loads(order, lineA), Map.of("batchId", batch, "quantity", 5), staff.token(), 201);
        fixtures.api("POST", loads(order, lineB), Map.of("batchId", batch, "quantity", 3), staff.token(), 201);

        var missing = fixtures.response("POST", wo(order, "complete"), Map.of("resultNote", "Đã nạp"), staff.token(), 409);
        assertThat(conflictCode(missing)).isEqualTo("RESTOCK_VARIANCE_REASON_REQUIRED");
        assertThat(missing.path("message").asText()).contains(lineA.path("id").asText()).doesNotContain(lineB.path("id").asText());
        var variance = Map.of("resultNote", "Đã nạp", "lineVariances", List.of(Map.of("lineId", lineA.path("id").asText(), "reason", "Lô mới chỉ đủ 5 tô")));
        jdbc.update("UPDATE machine_slots SET refill_gate_open = TRUE WHERE id = ?", rig.b());
        assertThat(conflictCode(fixtures.response("POST", wo(order, "complete"), variance, staff.token(), 409))).isEqualTo("REFILL_GATE_OPEN");
        jdbc.update("UPDATE machine_slots SET refill_gate_open = FALSE WHERE id = ?", rig.b());
        var done = fixtures.api("POST", wo(order, "complete"), variance, staff.token(), 200);
        assertThat(done.path("status").asText()).isEqualTo("DONE");
        assertThat(done.path("restockSummary").path("varianceLines").asInt()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT variance_reason FROM restock_lines WHERE id = ?", String.class, UUID.fromString(lineA.path("id").asText())))
                .isEqualTo("Lô mới chỉ đủ 5 tô");

        // The COMPLETED event carries the summary; the health check ran: LOW_STOCK of the refilled column B is resolved by the system.
        JsonNode completed = null;
        for (JsonNode event : fixtures.api("GET", wo(order, "events"), null, admin.token(), 200)) if (event.path("type").asText().equals("COMPLETED")) completed = event;
        assertThat(completed.at("/details/restock/lines")).hasSize(2);
        assertThat(completed.at("/details/restock/removedByReason/EXPIRED").asInt()).isEqualTo(2);
        var alert = jdbc.queryForMap("SELECT status, resolved_by, resolution_note FROM alerts WHERE id = ?", lowB);
        assertThat(alert.get("status")).isEqualTo("RESOLVED");
        assertThat(alert.get("resolved_by")).isNull();
        assertThat(jdbc.queryForObject("SELECT status FROM machines WHERE id = ?", String.class, rig.machine())).isEqualTo("MAINTENANCE");
    }
}
