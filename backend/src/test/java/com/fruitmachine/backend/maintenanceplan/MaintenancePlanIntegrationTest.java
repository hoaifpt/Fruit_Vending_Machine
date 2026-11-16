package com.fruitmachine.backend.maintenanceplan;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.maintenanceplan.service.MaintenancePlanGenerator;
import com.fruitmachine.backend.maintenanceplan.service.MaintenancePlanScheduler;
import com.fruitmachine.backend.support.AbstractOrderIntegrationTest;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;

/** Issue #70 §6–§9: maintenance plans, generation of SCHEDULE work orders and the next due date, on real PostgreSQL. */
class MaintenancePlanIntegrationTest extends AbstractOrderIntegrationTest {
    static final String BASE = "/api/v1/maintenance-plans";
    @Autowired MaintenancePlanScheduler scheduler;
    @MockitoSpyBean MaintenancePlanGenerator generator;
    @Autowired BusinessCalendar calendar;

    // ---- helpers ----

    LocalDate today() {
        return calendar.today(clock.instant());
    }

    UUID machine() throws Exception {
        return fixtures.machine(admin.token());
    }

    Map<String, Object> body(UUID machine, int interval, int lead, LocalDate first, UUID assignee) {
        var body = new HashMap<String, Object>();
        body.put("machineId", machine);
        body.put("title", "Vệ sinh khoang lạnh");
        body.put("instructions", "Lau khay, kiểm tra gioăng");
        body.put("intervalDays", interval);
        body.put("leadDays", lead);
        if (first != null) body.put("firstDueDate", first.toString());
        if (assignee != null) body.put("defaultAssigneeId", assignee);
        return body;
    }

    JsonNode plan(UUID machine, int interval, int lead, LocalDate first, UUID assignee) throws Exception {
        return fixtures.api("POST", BASE, body(machine, interval, lead, first, assignee), admin.token(), 201);
    }

    String path(JsonNode plan, String action) {
        return BASE + "/" + plan.path("id").asText() + (action == null ? "" : "/" + action);
    }

    UUID id(JsonNode node) {
        return UUID.fromString(node.path("id").asText());
    }

    List<Map<String, Object>> workOrders(JsonNode plan) {
        return jdbc.queryForList("SELECT id, code, status, source, type, scheduled_for, due_at, assignee_id FROM work_orders WHERE maintenance_plan_id = ? ORDER BY created_at",
                id(plan));
    }

    void setNextDue(JsonNode plan, LocalDate date) {
        jdbc.update("UPDATE maintenance_plans SET next_due_date = ? WHERE id = ?", date, id(plan));
    }

    LocalDate nextDue(JsonNode plan) {
        return jdbc.queryForObject("SELECT next_due_date FROM maintenance_plans WHERE id = ?", LocalDate.class, id(plan));
    }

    String conflictCode(JsonNode error) {
        return error.path("message").asText().split(":")[0];
    }

    long notifications(UUID user, Object workOrder) {
        return jdbc.queryForObject("SELECT count(*) FROM notifications WHERE user_id = ? AND work_order_id = ?", Long.class, user, workOrder);
    }

    /** Starts and completes a generated work order as its assignee (or Admin). */
    void complete(UUID workOrder, String token) throws Exception {
        fixtures.api("POST", "/api/v1/work-orders/" + workOrder + "/start", null, token, 200);
        fixtures.api("POST", "/api/v1/work-orders/" + workOrder + "/complete", Map.of("resultNote", "Đã vệ sinh"), token, 200);
    }

    // ---- 6. migration ----

    @Test
    void theSchemaTiesScheduleWorkOrdersToOneOccurrenceOfAMaintenancePlan() throws Exception {
        UUID machine = machine();
        var plan = plan(machine, 7, 0, today(), null);
        scheduler.runOnce(clock.instant());
        var generated = workOrders(plan).getFirst();
        var manual = fixtures.api("POST", "/api/v1/work-orders", Map.of("type", "MAINTENANCE", "machineId", machine, "title", "Thủ công"), admin.token(), 201);
        assertThatThrownBy(() -> jdbc.update("UPDATE work_orders SET source = 'SCHEDULE' WHERE id = ?", id(manual))).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE work_orders SET type = 'RESTOCK' WHERE id = ?", generated.get("id"))).isInstanceOf(DataIntegrityViolationException.class);
        String copy = "INSERT INTO work_orders (code, type, source, machine_id, title, status, maintenance_plan_id, scheduled_for, cancelled_at, cancel_reason) "
                + "VALUES (?, 'MAINTENANCE', 'SCHEDULE', ?, 'copy', ?, ?, ?, ?, ?)";
        assertThatThrownBy(() -> jdbc.update(copy, "WO-20261113-DUP1", machine, "CANCELLED", id(plan), generated.get("scheduled_for"), java.sql.Timestamp.from(clock.instant()), "x"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(copy, "WO-20261113-DUP2", machine, "OPEN", id(plan), today().plusDays(7), null, null))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    // ---- 7. plan management ----

    @Test
    void adminManagesPlansWithAuditStaffReadsAndInputIsValidated() throws Exception {
        UUID machine = machine();
        var plan = plan(machine, 7, 1, today().plusDays(5), staff.id());
        assertThat(plan.path("nextDueDate").asText()).isEqualTo(today().plusDays(5).toString());
        assertThat(plan.path("dueTime").asText()).isEqualTo("17:00");
        assertThat(plan.path("defaultAssignee").path("id").asText()).isEqualTo(staff.id().toString());
        assertThat(plan.path("machineCode").asText()).isNotBlank();
        assertThat(plan(machine, 10, 0, null, null).path("nextDueDate").asText()).isEqualTo(today().plusDays(10).toString());

        var patched = fixtures.api("PATCH", path(plan, null), Map.of("version", plan.path("version").asLong(), "intervalDays", 14, "dueTime", "08:30",
                "clearDefaultAssignee", true), admin.token(), 200);
        assertThat(patched.path("intervalDays").asInt()).isEqualTo(14);
        assertThat(patched.path("nextDueDate").asText()).isEqualTo(today().plusDays(5).toString());
        assertThat(patched.path("dueTime").asText()).isEqualTo("08:30");
        assertThat(patched.path("defaultAssignee").isNull()).isTrue();
        assertThat(conflictCode(fixtures.response("PATCH", path(plan, null), Map.of("version", plan.path("version").asLong(), "title", "x"), admin.token(), 409)))
                .isEqualTo("STALE_VERSION");
        fixtures.api("POST", path(plan, "deactivate"), null, admin.token(), 200);
        fixtures.api("POST", path(plan, "deactivate"), null, admin.token(), 200);
        assertThat(fixtures.api("POST", path(plan, "activate"), null, admin.token(), 200).path("active").asBoolean()).isTrue();
        assertThat(jdbc.queryForList("SELECT action FROM audit_logs WHERE entity_id = ? ORDER BY created_at, id", String.class, id(plan)))
                .containsExactly("MAINTENANCE_PLAN_CREATED", "MAINTENANCE_PLAN_UPDATED", "MAINTENANCE_PLAN_DEACTIVATED", "MAINTENANCE_PLAN_ACTIVATED");

        // Validation.
        fixtures.response("POST", BASE, body(machine, 0, 0, null, null), admin.token(), 400);
        fixtures.response("POST", BASE, body(machine, 366, 0, null, null), admin.token(), 400);
        fixtures.response("POST", BASE, body(machine, 3, 3, null, null), admin.token(), 400);
        fixtures.response("POST", BASE, body(machine, 7, 0, today().minusDays(1), null), admin.token(), 400);
        var inactiveUser = fixtures.staff(admin.token(), PASSWORD);
        jdbc.update("UPDATE users SET status = 'INACTIVE' WHERE id = ?", inactiveUser.id());
        fixtures.response("POST", BASE, body(machine, 7, 0, null, inactiveUser.id()), admin.token(), 400);
        fixtures.response("POST", BASE, body(UUID.randomUUID(), 7, 0, null, null), admin.token(), 404);
        UUID inactiveMachine = machine();
        jdbc.update("UPDATE machines SET status = 'INACTIVE' WHERE id = ?", inactiveMachine);
        assertThat(conflictCode(fixtures.response("POST", BASE, body(inactiveMachine, 7, 0, null, null), admin.token(), 409))).isEqualTo("MACHINE_INACTIVE");
        fixtures.response("PATCH", path(plan, null), Map.of("version", patched.path("version").asLong() + 50, "nextDueDate", today().minusDays(1).toString()), admin.token(), 409);
        var reloaded = fixtures.api("GET", path(plan, null), null, admin.token(), 200);
        fixtures.response("PATCH", path(plan, null), Map.of("version", reloaded.path("version").asLong(), "nextDueDate", today().minusDays(1).toString()), admin.token(), 400);

        // Authorization.
        assertThat(fixtures.api("GET", path(plan, null), null, staff.token(), 200).path("title").asText()).isEqualTo("Vệ sinh khoang lạnh");
        fixtures.response("POST", BASE, body(machine, 7, 0, null, null), staff.token(), 403);
        fixtures.response("POST", path(plan, "deactivate"), null, staff.token(), 403);
        fixtures.response("GET", BASE, null, null, 401);
        assertThat(kioskCall("GET", BASE, issueKey(machine), null).getResponse().getStatus()).isEqualTo(401);

        // Upcoming: in range, sorted, overdue flag.
        UUID other = machine();
        var soon = plan(other, 7, 0, today().plusDays(2), null);
        var later = plan(other, 30, 0, today().plusDays(20), null);
        var far = plan(other, 60, 0, today().plusDays(50), null);
        var late = plan(other, 7, 0, today(), null);
        setNextDue(late, today().minusDays(3));
        var upcoming = fixtures.api("GET", BASE + "/upcoming?days=30&machineId=" + other, null, staff.token(), 200);
        List<String> ids = new ArrayList<>();
        upcoming.forEach(p -> ids.add(p.path("id").asText()));
        assertThat(ids).containsExactly(late.path("id").asText(), soon.path("id").asText(), later.path("id").asText()).doesNotContain(far.path("id").asText());
        assertThat(upcoming.get(0).path("overdue").asBoolean()).isTrue();
        assertThat(upcoming.get(1).path("overdue").asBoolean()).isFalse();
        fixtures.response("GET", BASE + "/upcoming?days=91", null, staff.token(), 400);
        assertThat(fixtures.api("GET", BASE + "?machineId=" + other, null, staff.token(), 200).path("totalElements").asLong()).isEqualTo(4);
    }

    // ---- 8. generation ----

    @Test
    void duePlansCreateExactlyOneScheduledWorkOrderPerOccurrence() throws Exception {
        UUID machine = machine();
        var dueToday = plan(machine, 7, 0, today(), staff.id());
        var leadOne = plan(machine, 7, 1, today().plusDays(1), null);
        var notYet = plan(machine, 7, 1, today().plusDays(2), null);
        assertThat(scheduler.runOnce(clock.instant())).isGreaterThanOrEqualTo(2);
        var generated = workOrders(dueToday);
        assertThat(generated).hasSize(1);
        var order = generated.getFirst();
        assertThat(order).containsEntry("source", "SCHEDULE").containsEntry("type", "MAINTENANCE").containsEntry("status", "ASSIGNED")
                .containsEntry("assignee_id", staff.id());
        assertThat(order.get("scheduled_for").toString()).isEqualTo(today().toString());
        assertThat(((java.sql.Timestamp) order.get("due_at")).toInstant())
                .isEqualTo(today().atTime(17, 0).atZone(ZoneId.of("Asia/Ho_Chi_Minh")).toInstant());
        assertThat(notifications(staff.id(), order.get("id"))).isEqualTo(1);
        var unassigned = workOrders(leadOne);
        assertThat(unassigned).hasSize(1);
        assertThat(unassigned.getFirst()).containsEntry("status", "OPEN");
        assertThat(notifications(admin.id(), unassigned.getFirst().get("id"))).isEqualTo(1);
        assertThat(workOrders(notYet)).isEmpty();
        var view = fixtures.api("GET", "/api/v1/work-orders/" + order.get("id"), null, admin.token(), 200);
        assertThat(view.path("maintenancePlan").path("title").asText()).isEqualTo("Vệ sinh khoang lạnh");
        assertThat(view.path("scheduledFor").asText()).isEqualTo(today().toString());
        assertThat(view.path("description").asText()).isEqualTo("Lau khay, kiểm tra gioăng");
        assertThat(fixtures.api("GET", "/api/v1/work-orders?maintenancePlanId=" + dueToday.path("id").asText(), null, admin.token(), 200)
                .path("totalElements").asLong()).isEqualTo(1);
        assertThat(fixtures.api("GET", path(dueToday, null), null, admin.token(), 200).path("currentWorkOrder").path("code").asText())
                .isEqualTo(order.get("code"));

        // Repeated and concurrent runs, an unfinished work order: still one.
        scheduler.runOnce(clock.instant());
        var pool = Executors.newFixedThreadPool(3);
        try {
            var runs = new ArrayList<java.util.concurrent.Future<Integer>>();
            for (int i = 0; i < 3; i++) runs.add(pool.submit(() -> scheduler.runOnce(clock.instant())));
            for (var run : runs) run.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        assertThat(workOrders(dueToday)).hasSize(1);
        assertThat(workOrders(leadOne)).hasSize(1);
        assertThat(conflictCode(fixtures.response("POST", path(dueToday, "generate-now"), null, admin.token(), 409))).isEqualTo("PLAN_HAS_OPEN_WORK_ORDER");

        // An assignee who can no longer execute: OPEN, managers told.
        var gone = fixtures.staff(admin.token(), PASSWORD);
        var orphan = plan(machine(), 7, 0, today(), gone.id());
        jdbc.update("UPDATE users SET status = 'INACTIVE' WHERE id = ?", gone.id());
        scheduler.runOnce(clock.instant());
        assertThat(workOrders(orphan).getFirst()).containsEntry("status", "OPEN");
        assertThat(notifications(admin.id(), workOrders(orphan).getFirst().get("id"))).isEqualTo(1);

        // Inactive plan, INACTIVE machine: nothing. Three missed weeks: exactly one.
        var paused = plan(machine(), 7, 0, today(), null);
        fixtures.api("POST", path(paused, "deactivate"), null, admin.token(), 200);
        UUID stopped = machine();
        var onStopped = plan(stopped, 7, 0, today(), null);
        jdbc.update("UPDATE machines SET status = 'INACTIVE' WHERE id = ?", stopped);
        var missed = plan(machine(), 7, 0, today(), null);
        setNextDue(missed, today().minusDays(21));
        scheduler.runOnce(clock.instant());
        scheduler.runOnce(clock.instant());
        assertThat(workOrders(paused)).isEmpty();
        assertThat(workOrders(onStopped)).isEmpty();
        assertThat(workOrders(missed)).hasSize(1);
        assertThat(workOrders(missed).getFirst().get("scheduled_for").toString()).isEqualTo(today().minusDays(21).toString());
        assertThat(conflictCode(fixtures.response("POST", path(paused, "generate-now"), null, admin.token(), 409))).isEqualTo("MAINTENANCE_PLAN_INACTIVE");

        // generate-now ignores lead days.
        var early = plan(machine(), 30, 0, today().plusDays(20), null);
        var now = fixtures.api("POST", path(early, "generate-now"), null, admin.token(), 201);
        assertThat(now.path("source").asText()).isEqualTo("SCHEDULE");
        assertThat(now.path("scheduledFor").asText()).isEqualTo(today().plusDays(20).toString());
    }

    @Test
    void oneFailingPlanDoesNotStopTheOthers() throws Exception {
        var broken = plan(machine(), 7, 0, today(), null);
        var healthy = plan(machine(), 7, 0, today(), null);
        doThrow(new IllegalStateException("simulated")).when(generator).generateIfDue(eq(id(broken)), any());
        scheduler.runOnce(clock.instant());
        assertThat(workOrders(broken)).isEmpty();
        assertThat(workOrders(healthy)).hasSize(1);
    }

    // ---- 9. next due ----

    @Test
    void completionAndCancellationMoveTheNextDueDate() throws Exception {
        UUID machine = machine();
        // Completed on time: next = completion date + interval.
        var onTime = plan(machine, 7, 0, today(), staff.id());
        scheduler.runOnce(clock.instant());
        UUID first = (UUID) workOrders(onTime).getFirst().get("id");
        complete(first, staff.token());
        assertThat(nextDue(onTime)).isEqualTo(today().plusDays(7));
        assertThat(jdbc.queryForObject("SELECT last_completed_at IS NOT NULL FROM maintenance_plans WHERE id = ?", Boolean.class, id(onTime))).isTrue();

        // Completed late (occurrence 5 days ago): next = today + interval, not occurrence + interval.
        var lateOne = plan(machine(), 7, 0, today(), staff.id());
        setNextDue(lateOne, today().minusDays(5));
        scheduler.runOnce(clock.instant());
        complete((UUID) workOrders(lateOne).getFirst().get("id"), staff.token());
        assertThat(nextDue(lateOne)).isEqualTo(today().plusDays(7));

        // Cancelled: the occurrence is skipped.
        var skipped = plan(machine(), 7, 0, today(), null);
        scheduler.runOnce(clock.instant());
        var generated = fixtures.api("GET", "/api/v1/work-orders/" + workOrders(skipped).getFirst().get("id"), null, admin.token(), 200);
        fixtures.api("POST", "/api/v1/work-orders/" + generated.path("id").asText() + "/cancel",
                Map.of("reason", "Máy đang sửa", "version", generated.path("version").asLong()), admin.token(), 200);
        assertThat(nextDue(skipped)).isEqualTo(today().plusDays(7));
        scheduler.runOnce(clock.instant());
        assertThat(workOrders(skipped)).hasSize(1);

        // A later date the Admin set is kept.
        var moved = plan(machine(), 7, 0, today(), staff.id());
        scheduler.runOnce(clock.instant());
        var current = fixtures.api("GET", path(moved, null), null, admin.token(), 200);
        fixtures.api("PATCH", path(moved, null), Map.of("version", current.path("version").asLong(), "nextDueDate", today().plusDays(30).toString()), admin.token(), 200);
        complete((UUID) workOrders(moved).getFirst().get("id"), staff.token());
        assertThat(nextDue(moved)).isEqualTo(today().plusDays(30));

        // A manual MAINTENANCE work order never touches a plan.
        var untouched = plan(machine, 14, 0, today().plusDays(3), null);
        var manual = fixtures.api("POST", "/api/v1/work-orders", Map.of("type", "MAINTENANCE", "machineId", machine, "title", "Thủ công", "assigneeId", staff.id()),
                admin.token(), 201);
        complete(id(manual), staff.token());
        assertThat(nextDue(untouched)).isEqualTo(today().plusDays(3));
        assertThat(fixtures.api("GET", path(onTime, "work-orders"), null, staff.token(), 200)).hasSize(1);
    }
}
