package com.fruitmachine.backend.workorder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.alert.enums.AlertSeverity;
import com.fruitmachine.backend.alert.enums.AlertType;
import com.fruitmachine.backend.alert.service.AlertService;
import com.fruitmachine.backend.alert.service.AlertSpec;
import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import com.fruitmachine.backend.support.TestDataFactory;
import com.fruitmachine.backend.workorder.enums.WorkOrderPriority;
import com.fruitmachine.backend.workorder.enums.WorkOrderSource;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;
import com.fruitmachine.backend.workorder.job.WorkOrderOverdueJob;
import com.fruitmachine.backend.workorder.service.WorkOrderService;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Issue #66 §8–§13: work order lifecycle, machine stop, alerts, notifications, overdue and authorization on real PostgreSQL. */
class WorkOrderIntegrationTest extends AbstractWebhookIntegrationTest {
    static final String BASE = "/api/v1/work-orders";
    @Autowired WorkOrderService service;
    @Autowired WorkOrderOverdueJob overdueJob;
    @Autowired AlertService alertService;
    @Autowired TransactionTemplate transactions;

    // ---- helpers ----

    UUID machine() throws Exception {
        return fixtures.machine(admin.token());
    }

    Map<String, Object> body(String type, UUID machine, UUID assignee) {
        var body = new HashMap<String, Object>();
        body.put("type", type);
        body.put("machineId", machine);
        body.put("title", "Kiểm tra servo cột A");
        if (assignee != null) body.put("assigneeId", assignee);
        return body;
    }

    JsonNode create(String type, UUID machine, UUID assignee) throws Exception {
        return fixtures.api("POST", BASE, body(type, machine, assignee), admin.token(), 201);
    }

    String path(JsonNode order, String action) {
        return BASE + "/" + order.path("id").asText() + (action == null ? "" : "/" + action);
    }

    JsonNode reload(JsonNode order) throws Exception {
        return fixtures.api("GET", path(order, null), null, admin.token(), 200);
    }

    long version(JsonNode order) throws Exception {
        return reload(order).path("version").asLong();
    }

    String machineStatus(UUID machine) {
        return jdbc.queryForObject("SELECT status FROM machines WHERE id = ?", String.class, machine);
    }

    long notifications(UUID user, JsonNode order) {
        return jdbc.queryForObject("SELECT count(*) FROM notifications WHERE user_id = ? AND work_order_id = ?", Long.class, user,
                UUID.fromString(order.path("id").asText()));
    }

    List<String> eventTypes(JsonNode order) throws Exception {
        return types(fixtures.api("GET", path(order, "events"), null, admin.token(), 200));
    }

    /** Top-level type of each event (details may carry a "type" of their own). */
    static List<String> types(JsonNode events) {
        var out = new java.util.ArrayList<String>();
        events.forEach(event -> out.add(event.path("type").asText()));
        return out;
    }

    UUID raise(UUID machine, AlertType type, AlertSeverity severity) {
        String key = "WO-TEST:" + UUID.randomUUID();
        transactions.executeWithoutResult(s -> alertService.raise(new AlertSpec(type, severity, machine, null, null, key, "Alert " + type, "Test"),
                clock.instant().truncatedTo(ChronoUnit.MICROS)));
        return jdbc.queryForObject("SELECT id FROM alerts WHERE dedupe_key = ?", UUID.class, key);
    }

    /** Issue #68: a RESTOCK work order needs a restock line before it can start. */
    void addRestockLine(JsonNode order, UUID slot, UUID product) throws Exception {
        fixtures.api("POST", path(order, "restock-lines"), Map.of("slotId", slot, "productId", product, "plannedQuantity", 0), admin.token(), 201);
    }

    String conflictCode(JsonNode error) {
        return error.path("message").asText().split(":")[0];
    }

    // ---- 8. migration ----

    @Test
    void theSchemaRequiresResultsReasonsAndAssigneesAndKeepsHistoryAppendOnly() throws Exception {
        UUID machine = machine();
        var order = create("MAINTENANCE", machine, null);
        UUID id = UUID.fromString(order.path("id").asText());
        assertThatThrownBy(() -> jdbc.update("UPDATE work_orders SET status = 'ASSIGNED' WHERE id = ?", id)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE work_orders SET status = 'CANCELLED', cancelled_at = now() WHERE id = ?", id))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE work_orders SET status = 'DONE', assignee_id = ?, started_at = now(), completed_at = now(), completed_by = ? WHERE id = ?",
                staff.id(), staff.id(), id)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE work_order_events SET note = 'changed' WHERE work_order_id = ?", id)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM work_order_events WHERE work_order_id = ?", id)).isInstanceOf(DataAccessException.class);
        assertThat(order.path("code").asText()).matches("WO-\\d{8}-[0-9A-HJKMNP-TV-Z]{4}");
    }

    // ---- 9. lifecycle ----

    @Test
    void theLifecycleFromCreationToCompletionWithOneEventPerAction() throws Exception {
        UUID machine = machine();
        var open = create("MAINTENANCE", machine, null);
        assertThat(open.path("status").asText()).isEqualTo("OPEN");
        assertThat(open.path("source").asText()).isEqualTo("MANUAL");
        assertThat(open.path("createdBy").path("id").asText()).isEqualTo(admin.id().toString());
        var assigned = fixtures.api("POST", path(open, "assign"), Map.of("assigneeId", staff.id(), "version", open.path("version").asLong()), admin.token(), 200);
        assertThat(assigned.path("status").asText()).isEqualTo("ASSIGNED");
        assertThat(notifications(staff.id(), open)).isEqualTo(1);
        fixtures.response("POST", path(open, "assign"), Map.of("assigneeId", staff.id(), "version", open.path("version").asLong()), admin.token(), 409);
        var unassigned = fixtures.api("POST", path(open, "unassign"), Map.of("version", assigned.path("version").asLong()), admin.token(), 200);
        assertThat(unassigned.path("status").asText()).isEqualTo("OPEN");
        assertThat(unassigned.path("assignee").isNull()).isTrue();
        fixtures.api("POST", path(open, "assign"), Map.of("assigneeId", staff.id(), "version", unassigned.path("version").asLong()), admin.token(), 200);

        var other = fixtures.staff(admin.token(), PASSWORD);
        fixtures.response("POST", path(open, "start"), null, other.token(), 404);
        fixtures.response("GET", path(open, null), null, other.token(), 404);
        var started = fixtures.api("POST", path(open, "start"), null, staff.token(), 200);
        assertThat(started.path("status").asText()).isEqualTo("IN_PROGRESS");
        assertThat(started.path("startedAt").isNull()).isFalse();
        var again = fixtures.api("POST", path(open, "start"), null, staff.token(), 200);
        assertThat(again.path("version").asLong()).isEqualTo(started.path("version").asLong());

        // Reassign while in progress keeps the status.
        var reassigned = fixtures.api("POST", path(open, "assign"), Map.of("assigneeId", other.id(), "version", started.path("version").asLong()), admin.token(), 200);
        assertThat(reassigned.path("status").asText()).isEqualTo("IN_PROGRESS");
        assertThat(reassigned.path("assignee").path("id").asText()).isEqualTo(other.id().toString());
        fixtures.response("POST", path(open, "complete"), Map.of("resultNote", "x"), staff.token(), 404);
        fixtures.api("POST", path(open, "notes"), Map.of("note", "Đã tháo servo 2"), other.token(), 200);
        fixtures.response("POST", path(open, "complete"), Map.of("resultNote", " "), other.token(), 400);
        fixtures.response("PATCH", path(open, null), Map.of("title", "Old version", "version", started.path("version").asLong()), admin.token(), 409);
        var done = fixtures.api("POST", path(open, "complete"), Map.of("resultNote", "Thay servo 2"), other.token(), 200);
        assertThat(done.path("status").asText()).isEqualTo("DONE");
        assertThat(done.path("completedBy").path("id").asText()).isEqualTo(other.id().toString());
        assertThat(done.path("resultNote").asText()).isEqualTo("Thay servo 2");

        // Final.
        assertThat(conflictCode(fixtures.response("POST", path(open, "cancel"), Map.of("reason", "late", "version", done.path("version").asLong()), admin.token(), 409)))
                .isEqualTo("INVALID_WORK_ORDER_TRANSITION");
        assertThat(conflictCode(fixtures.response("POST", path(open, "start"), null, admin.token(), 409))).isEqualTo("INVALID_WORK_ORDER_TRANSITION");
        fixtures.response("POST", path(open, "notes"), Map.of("note", "after"), admin.token(), 409);

        var history = fixtures.api("GET", path(open, "events"), null, admin.token(), 200);
        assertThat(types(history)).containsExactly("CREATED", "ASSIGNED", "UNASSIGNED", "ASSIGNED", "STARTED", "ASSIGNED", "NOTE", "COMPLETED");
        assertThat(history.get(0).path("actor").path("id").asText()).isEqualTo(admin.id().toString());
        assertThat(history.get(4).path("statusBefore").asText()).isEqualTo("ASSIGNED");
        assertThat(history.get(4).path("statusAfter").asText()).isEqualTo("IN_PROGRESS");
        assertThat(history.get(6).path("note").asText()).isEqualTo("Đã tháo servo 2");
        assertThat(history.get(7).path("actor").path("id").asText()).isEqualTo(other.id().toString());

        // Cancel from OPEN; Admin can start for an assignee.
        var cancelled = create("INCIDENT", machine, null);
        fixtures.response("POST", path(cancelled, "cancel"), Map.of("reason", " ", "version", cancelled.path("version").asLong()), admin.token(), 400);
        assertThat(fixtures.api("POST", path(cancelled, "cancel"), Map.of("reason", "Trùng việc", "version", cancelled.path("version").asLong()), admin.token(), 200)
                .path("status").asText()).isEqualTo("CANCELLED");
        var forAdmin = create("INCIDENT", machine, staff.id());
        assertThat(fixtures.api("POST", path(forAdmin, "start"), null, admin.token(), 200).path("status").asText()).isEqualTo("IN_PROGRESS");

        // Validation.
        var bad = body("MAINTENANCE", machine, null);
        bad.put("dueAt", clock.instant().minusSeconds(60).toString());
        fixtures.response("POST", BASE, bad, admin.token(), 400);
        fixtures.response("POST", BASE, body("MAINTENANCE", UUID.randomUUID(), null), admin.token(), 404);
        fixtures.response("POST", BASE, body("MAINTENANCE", machine, UUID.randomUUID()), admin.token(), 400);
        jdbc.update("UPDATE users SET status = 'INACTIVE' WHERE id = ?", other.id());
        fixtures.response("POST", BASE, body("MAINTENANCE", machine, other.id()), admin.token(), 400);
    }

    // ---- 10. machine stop ----

    @Test
    void startingStopsTheMachineAndOnlyAnAdminReactivatesItAfterwards() throws Exception {
        var shop = shop(3);
        var order = create("RESTOCK", shop.machineId(), staff.id());
        addRestockLine(order, shop.slotId(), shop.productId());
        // A customer order is open: wait for it.
        var placed = placeOrder(shop);
        assertThat(conflictCode(fixtures.response("POST", path(order, "start"), null, staff.token(), 409))).isEqualTo("MACHINE_HAS_ACTIVE_ORDERS");
        kioskData("POST", placed.order() + "/cancel", shop.key(), null, 200);
        var started = fixtures.api("POST", path(order, "start"), null, staff.token(), 200);
        assertThat(machineStatus(shop.machineId())).isEqualTo("MAINTENANCE");
        assertThat(fixtures.api("GET", path(order, "events"), null, admin.token(), 200).get(1).path("details").path("machineStopped").asBoolean()).isTrue();
        assertThat(kioskData("GET", "/api/v1/kiosk/catalog", shop.key(), null, 200).path("acceptingOrders").asBoolean()).isFalse();
        kioskJson("POST", "/api/v1/kiosk/orders", shop.key(), orderBody(shop.productId()), 409);

        // Reactivation waits for the work order; completion waits for maintenance commands.
        String status = "/api/v1/machines/" + shop.machineId() + "/status";
        assertThat(conflictCode(fixtures.response("PATCH", status, Map.of("status", "ACTIVE"), admin.token(), 409))).isEqualTo("WORK_ORDER_IN_PROGRESS");
        jdbc.update("INSERT INTO maintenance_commands (command_code, machine_id, slot_id, operation, status, requested_by, idempotency_key) "
                + "VALUES (?, ?, ?, 'CLOSE_REFILL', 'SENT', ?, 'wo-test-key')", "MC-wo" + UUID.randomUUID().toString().substring(0, 8), shop.machineId(), shop.slotId(), staff.id());
        assertThat(conflictCode(fixtures.response("POST", path(order, "complete"), Map.of("resultNote", "Đã nạp"), staff.token(), 409)))
                .isEqualTo("MACHINE_COMMAND_IN_PROGRESS");
        jdbc.update("UPDATE maintenance_commands SET status = 'FAILED', finished_at = now() WHERE machine_id = ?", shop.machineId());
        fixtures.api("POST", path(order, "complete"), Map.of("resultNote", "Đã nạp"), staff.token(), 200);
        assertThat(machineStatus(shop.machineId())).isEqualTo("MAINTENANCE");
        fixtures.api("PATCH", status, Map.of("status", "ACTIVE"), admin.token(), 200);
        assertThat(started.path("status").asText()).isEqualTo("IN_PROGRESS");

        // INCIDENT: the machine keeps selling unless asked.
        var incident = create("INCIDENT", shop.machineId(), staff.id());
        fixtures.api("POST", path(incident, "start"), null, staff.token(), 200);
        assertThat(machineStatus(shop.machineId())).isEqualTo("ACTIVE");
        var stopping = create("INCIDENT", shop.machineId(), staff.id());
        fixtures.api("POST", path(stopping, "start"), Map.of("stopMachine", true), staff.token(), 200);
        assertThat(machineStatus(shop.machineId())).isEqualTo("MAINTENANCE");

        // An unfinished dispense command and an INACTIVE machine.
        var paidShop = shop(2);
        PlacedOrder paid = placeOrder(paidShop);
        pay(paid, 201);
        assertThat(paid(referenceOf(paid.orderId()), "TXN-" + paid.orderId(), orderTotal(paid.orderId()))).isEqualTo(200);
        jdbc.update("UPDATE orders SET status = 'DISPENSE_FAILED' WHERE id = ?", paid.orderId());
        var blocked = create("MAINTENANCE", paidShop.machineId(), staff.id());
        assertThat(conflictCode(fixtures.response("POST", path(blocked, "start"), null, staff.token(), 409))).isEqualTo("MACHINE_COMMAND_IN_PROGRESS");
        var inactive = create("MAINTENANCE", paidShop.machineId(), staff.id());
        jdbc.update("UPDATE machines SET status = 'INACTIVE' WHERE id = ?", paidShop.machineId());
        assertThat(conflictCode(fixtures.response("POST", path(inactive, "start"), null, staff.token(), 409))).isEqualTo("MACHINE_INACTIVE");
        assertThat(conflictCode(fixtures.response("POST", BASE, body("MAINTENANCE", paidShop.machineId(), null), admin.token(), 409))).isEqualTo("MACHINE_INACTIVE");
    }

    // ---- 11. alerts ----

    @Test
    void workOrdersFromAlertsAcknowledgeLinkAndResolveThem() throws Exception {
        UUID machine = machine();
        UUID lowStock = raise(machine, AlertType.LOW_STOCK, AlertSeverity.WARNING);
        var fromAlert = fixtures.api("POST", "/api/v1/alerts/" + lowStock + "/work-orders", Map.of("assigneeId", staff.id()), admin.token(), 201);
        assertThat(fromAlert.path("type").asText()).isEqualTo("RESTOCK");
        assertThat(fromAlert.path("priority").asText()).isEqualTo("HIGH");
        assertThat(fromAlert.path("source").asText()).isEqualTo("ALERT");
        assertThat(fromAlert.path("title").asText()).isEqualTo("Alert LOW_STOCK");
        assertThat(fromAlert.path("linkedAlerts").findValuesAsText("id")).containsExactly(lowStock.toString());
        var alert = fixtures.api("GET", "/api/v1/alerts/" + lowStock, null, admin.token(), 200);
        assertThat(alert.path("status").asText()).isEqualTo("ACKNOWLEDGED");
        assertThat(alert.path("workOrderCode").asText()).isEqualTo(fromAlert.path("code").asText());
        var handled = fixtures.response("POST", "/api/v1/alerts/" + lowStock + "/work-orders", null, admin.token(), 409);
        assertThat(conflictCode(handled)).isEqualTo("ALERT_ALREADY_HANDLED");
        assertThat(handled.path("message").asText()).contains(fromAlert.path("code").asText());

        UUID fault = raise(machine, AlertType.HARDWARE_FAULT, AlertSeverity.CRITICAL);
        fixtures.api("POST", path(fromAlert, "alerts"), Map.of("alertId", fault), admin.token(), 200);
        UUID elsewhere = raise(machine(), AlertType.HARDWARE_FAULT, AlertSeverity.CRITICAL);
        fixtures.response("POST", path(fromAlert, "alerts"), Map.of("alertId", elsewhere), admin.token(), 400);
        assertThat(fixtures.api("POST", "/api/v1/alerts/" + elsewhere + "/work-orders", null, admin.token(), 201).path("priority").asText()).isEqualTo("URGENT");

        addRestockLine(fromAlert, createSlot(machine, "A", 6), createProduct("Restock bowl", "35000"));
        fixtures.api("POST", path(fromAlert, "start"), null, staff.token(), 200);
        fixtures.api("POST", path(fromAlert, "complete"), Map.of("resultNote", "Đã nạp 5 tô"), staff.token(), 200);
        var resolved = jdbc.queryForMap("SELECT status, resolved_by, resolution_note FROM alerts WHERE id = ?", lowStock);
        assertThat(resolved).containsEntry("status", "RESOLVED").containsEntry("resolved_by", staff.id())
                .containsEntry("resolution_note", "Resolved by " + fromAlert.path("code").asText());
        assertThat(jdbc.queryForObject("SELECT status FROM alerts WHERE id = ?", String.class, fault)).isEqualTo("RESOLVED");
        assertThat(fixtures.api("GET", "/api/v1/alerts/" + lowStock, null, admin.token(), 200).path("workOrderId").isNull()).isTrue();
        fixtures.response("POST", "/api/v1/alerts/" + lowStock + "/work-orders", null, admin.token(), 409);

        // resolveLinkedAlerts = false leaves them as they are.
        UUID kept = raise(machine, AlertType.MACHINE_OFFLINE, AlertSeverity.INFO);
        var keep = fixtures.api("POST", "/api/v1/alerts/" + kept + "/work-orders", Map.of("assigneeId", staff.id()), admin.token(), 201);
        assertThat(keep.path("type").asText()).isEqualTo("MAINTENANCE");
        assertThat(keep.path("priority").asText()).isEqualTo("NORMAL");
        fixtures.api("POST", path(keep, "start"), null, staff.token(), 200);
        fixtures.api("POST", path(keep, "complete"), Map.of("resultNote", "Wifi ok", "resolveLinkedAlerts", false), staff.token(), 200);
        assertThat(jdbc.queryForObject("SELECT status FROM alerts WHERE id = ?", String.class, kept)).isEqualTo("ACKNOWLEDGED");

        // Unlinking frees the alert for another work order.
        UUID free = raise(machine, AlertType.HIGH_HUMIDITY, AlertSeverity.WARNING);
        var first = fixtures.api("POST", "/api/v1/alerts/" + free + "/work-orders", null, admin.token(), 201);
        fixtures.api("DELETE", path(first, "alerts") + "/" + free, null, admin.token(), 200);
        fixtures.api("POST", "/api/v1/alerts/" + free + "/work-orders", null, admin.token(), 201);
    }

    // ---- 12. notifications and overdue ----

    @Test
    void theRightPeopleAreNotifiedOnceAndOverdueWorkIsAnnouncedOnce() throws Exception {
        UUID machine = machine();
        var order = create("MAINTENANCE", machine, staff.id());
        assertThat(notifications(staff.id(), order)).isEqualTo(1);
        assertThat(notifications(admin.id(), order)).isZero();
        fixtures.api("POST", path(order, "start"), null, staff.token(), 200);
        fixtures.api("POST", path(order, "complete"), Map.of("resultNote", "Xong"), staff.token(), 200);
        // The creator hears about the completion; the completer does not.
        assertThat(notifications(admin.id(), order)).isEqualTo(1);
        assertThat(notifications(staff.id(), order)).isEqualTo(1);
        var mine = fixtures.api("GET", "/api/v1/notifications/me?size=100", null, admin.token(), 200).path("content");
        assertThat(mine.findValuesAsText("workOrderId")).contains(order.path("id").asText());

        var cancelled = create("MAINTENANCE", machine, staff.id());
        fixtures.api("POST", path(cancelled, "cancel"), Map.of("reason", "Không cần", "version", cancelled.path("version").asLong()), admin.token(), 200);
        assertThat(notifications(staff.id(), cancelled)).isEqualTo(2);
        assertThat(notifications(admin.id(), cancelled)).isZero();

        // System-created and unassigned: every manager.
        var system = transactions.execute(s -> service.createBySystem(WorkOrderType.MAINTENANCE, WorkOrderSource.CUSTOMER_REPORT, machine, "Bảo trì định kỳ",
                null, WorkOrderPriority.LOW, null, List.of()));
        assertThat(system.getCreatedBy()).isNull();
        var systemJson = fixtures.api("GET", BASE + "/" + system.getId(), null, admin.token(), 200);
        assertThat(systemJson.path("createdBy").isNull()).isTrue();
        assertThat(notifications(admin.id(), systemJson)).isEqualTo(1);
        assertThat(notifications(staff.id(), systemJson)).isZero();
        assertThat(eventTypes(systemJson)).containsExactly("CREATED");

        // Overdue: once, re-armed by a new due time, never for finished work.
        var due = body("MAINTENANCE", machine, staff.id());
        due.put("dueAt", clock.instant().plusSeconds(60).toString());
        var late = fixtures.api("POST", BASE, due, admin.token(), 201);
        assertThat(late.path("overdue").asBoolean()).isFalse();
        clock.advance(Duration.ofMinutes(2));
        int first = overdueJob.runOnce(clock.instant());
        assertThat(first).isPositive();
        assertThat(overdueJob.runOnce(clock.instant())).isZero();
        assertThat(notifications(staff.id(), late)).isEqualTo(2);
        assertThat(reload(late).path("overdue").asBoolean()).isTrue();
        assertThat(fixtures.api("GET", BASE + "?overdue=true&machineId=" + machine, null, admin.token(), 200).path("content").findValuesAsText("code"))
                .contains(late.path("code").asText());
        fixtures.api("PATCH", path(late, null), Map.of("dueAt", clock.instant().plusSeconds(60).toString(), "version", version(late)), admin.token(), 200);
        clock.advance(Duration.ofMinutes(2));
        overdueJob.runOnce(clock.instant());
        assertThat(notifications(staff.id(), late)).isEqualTo(3);
        assertThat(eventTypes(late)).containsExactly("CREATED", "OVERDUE", "UPDATED", "OVERDUE");

        var finished = fixtures.api("POST", BASE, Map.of("type", "MAINTENANCE", "machineId", machine, "title", "Done early", "assigneeId", staff.id(),
                "dueAt", clock.instant().plusSeconds(60).toString()), admin.token(), 201);
        fixtures.api("POST", path(finished, "start"), null, staff.token(), 200);
        fixtures.api("POST", path(finished, "complete"), Map.of("resultNote", "ok"), staff.token(), 200);
        clock.advance(Duration.ofMinutes(2));
        overdueJob.runOnce(clock.instant());
        assertThat(eventTypes(finished)).doesNotContain("OVERDUE");
    }

    // ---- 13. authorization and reads ----

    @Test
    void staffSeesOnlyTheirOwnWorkOrdersAndCannotManage() throws Exception {
        UUID machine = machine();
        var mine = create("MAINTENANCE", machine, staff.id());
        var others = create("RESTOCK", machine, null);
        fixtures.response("GET", BASE, null, staff.token(), 403);
        var list = fixtures.api("GET", BASE + "/me", null, staff.token(), 200).path("content");
        assertThat(list.findValuesAsText("code")).contains(mine.path("code").asText()).doesNotContain(others.path("code").asText());
        fixtures.response("GET", path(others, null), null, staff.token(), 404);
        fixtures.response("GET", path(others, "events"), null, staff.token(), 404);
        assertThat(fixtures.api("GET", path(mine, null), null, staff.token(), 200).path("code").asText()).isEqualTo(mine.path("code").asText());

        fixtures.response("POST", BASE, body("MAINTENANCE", machine, null), staff.token(), 403);
        fixtures.response("POST", path(mine, "assign"), Map.of("assigneeId", staff.id(), "version", 0), staff.token(), 403);
        fixtures.response("POST", path(mine, "cancel"), Map.of("reason", "x", "version", 0), staff.token(), 403);
        fixtures.response("PATCH", path(mine, null), Map.of("title", "x", "version", 0), staff.token(), 403);
        fixtures.response("GET", BASE + "/me", null, null, 401);
        String key = issueKey(machine);
        assertThat(kioskCall("GET", BASE + "/me", key, null).getResponse().getStatus()).isEqualTo(401);

        // Admin list: filters, priority first.
        var urgent = fixtures.api("POST", BASE, Map.of("type", "INCIDENT", "machineId", machine, "title", "Khẩn", "priority", "URGENT"), admin.token(), 201);
        var page = fixtures.api("GET", BASE + "?machineId=" + machine + "&status=OPEN&status=ASSIGNED", null, admin.token(), 200).path("content");
        assertThat(page.get(0).path("code").asText()).isEqualTo(urgent.path("code").asText());
        assertThat(fixtures.api("GET", BASE + "?machineId=" + machine + "&type=RESTOCK", null, admin.token(), 200).path("totalElements").asLong()).isEqualTo(1);
        assertThat(fixtures.api("GET", BASE + "?machineId=" + machine + "&assigneeId=" + staff.id(), null, admin.token(), 200).path("totalElements").asLong()).isEqualTo(1);
        fixtures.response("GET", BASE + "?size=101", null, admin.token(), 400);
        fixtures.response("GET", BASE + "?status=FINISHED", null, admin.token(), 400);
        var edited = fixtures.api("PATCH", path(others, null), Map.of("description", "Nạp 10 tô", "priority", "LOW", "version", others.path("version").asLong()), admin.token(), 200);
        assertThat(edited.path("description").asText()).isEqualTo("Nạp 10 tô");
        assertThat(edited.path("version").asLong()).isEqualTo(others.path("version").asLong() + 1);
        var unchanged = fixtures.api("PATCH", path(others, null), Map.of("priority", "LOW", "version", edited.path("version").asLong()), admin.token(), 200);
        assertThat(unchanged.path("version").asLong()).isEqualTo(edited.path("version").asLong());
        assertThat(eventTypes(others)).containsExactly("CREATED", "UPDATED");
        assertThat(TestDataFactory.class).isNotNull();
        assertThat(Instant.now()).isNotNull();
    }
}
