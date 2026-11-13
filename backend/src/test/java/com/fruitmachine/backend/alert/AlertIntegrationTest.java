package com.fruitmachine.backend.alert;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.alert.enums.AlertSeverity;
import com.fruitmachine.backend.alert.enums.AlertType;
import com.fruitmachine.backend.alert.repository.HealthCheckQueries;
import com.fruitmachine.backend.alert.service.AlertService;
import com.fruitmachine.backend.alert.service.AlertSpec;
import com.fruitmachine.backend.alert.service.MachineHealthCheckRunner;
import com.fruitmachine.backend.dispense.service.DispenseReport;
import com.fruitmachine.backend.dispense.service.DispenseService;
import com.fruitmachine.backend.mqtt.MachineMessageHandler;
import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;

/** Issue #58: alerts from the health check, dispense events and machine faults; notifications; alert and notification APIs. */
class AlertIntegrationTest extends AbstractWebhookIntegrationTest {
    @Autowired MachineHealthCheckRunner runner;
    @Autowired AlertService alertService;
    @Autowired DispenseService dispense;
    @Autowired MachineMessageHandler messages;
    @Autowired TransactionTemplate transactions;
    @MockitoSpyBean HealthCheckQueries queries;
    int sequence;

    // ---- helpers ----

    Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }

    UUID activeMachine() throws Exception {
        return fixtures.machine(admin.token());
    }

    String codeOf(UUID machine) {
        return jdbc.queryForObject("SELECT code FROM machines WHERE id=?", String.class, machine);
    }

    String machineStatus(UUID machine) {
        return jdbc.queryForObject("SELECT status FROM machines WHERE id=?", String.class, machine);
    }

    List<Map<String, Object>> alerts(UUID machine) {
        return jdbc.queryForList("SELECT id, type, severity, status, error_code, slot_id, resolved_by, resolution_note FROM alerts WHERE machine_id=? ORDER BY triggered_at, id", machine);
    }

    List<Map<String, Object>> open(UUID machine, String type) {
        return jdbc.queryForList("SELECT id, severity, error_code, slot_id FROM alerts WHERE machine_id=? AND type=? AND status<>'RESOLVED'", machine, type);
    }

    long count(UUID machine, String type) {
        return jdbc.queryForObject("SELECT count(*) FROM alerts WHERE machine_id=? AND type=?", Long.class, machine, type);
    }

    void reading(UUID machine, Instant at, String temperature, String humidity) {
        jdbc.update("INSERT INTO sensor_readings (machine_id, temperature, humidity, recorded_at) VALUES (?, ?, ?, ?)", machine,
                temperature == null ? null : new BigDecimal(temperature), humidity == null ? null : new BigDecimal(humidity), Timestamp.from(at));
    }

    void seen(UUID machine, Instant at) {
        jdbc.update("UPDATE machines SET last_seen_at=?, last_offline_at=NULL WHERE id=?", Timestamp.from(at), machine);
    }

    void event(UUID machine, String payload) {
        String code = codeOf(machine);
        messages.handle(code, "events", ("{\"schemaVersion\":1,\"messageId\":\"a-" + (++sequence) + "-" + UUID.randomUUID().toString().substring(0, 6)
                + "\",\"machineCode\":\"" + code + "\",\"payload\":" + payload + "}").getBytes(StandardCharsets.UTF_8));
    }

    long notificationsOf(Object alertId) {
        return jdbc.queryForObject("SELECT count(*) FROM notifications WHERE alert_id=?", Long.class, alertId);
    }

    long notifiable() {
        return jdbc.queryForObject("""
                SELECT count(DISTINCT u.id) FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN role_permissions rp ON rp.role_id = ur.role_id
                JOIN permissions p ON p.id = rp.permission_id WHERE p.code = 'ALERT_NOTIFY' AND u.status = 'ACTIVE'""", Long.class);
    }

    UUID raise(UUID machine, AlertType type, AlertSeverity severity, String key) {
        transactions.executeWithoutResult(s -> alertService.raise(new AlertSpec(type, severity, machine, null, null, key, "Test " + type, "Test alert"), now()));
        return jdbc.queryForObject("SELECT id FROM alerts WHERE dedupe_key=? AND status<>'RESOLVED'", UUID.class, key);
    }

    // ---- 9. migration ----

    @Test
    void v17ConstraintsHold() throws Exception {
        UUID machine = activeMachine(), other = activeMachine();
        UUID otherSlot = createSlot(other, "A", 5);
        String insert = "INSERT INTO alerts (machine_id, type, severity, title, dedupe_key, status, resolved_at) VALUES (?, ?, 'INFO', 't', ?, ?, ?)";
        jdbc.update(insert, machine, "LOW_STOCK", "K:" + machine, "OPEN", null);
        assertThatThrownBy(() -> jdbc.update(insert, machine, "LOW_STOCK", "K:" + machine, "ACKNOWLEDGED", null)).isInstanceOf(DataIntegrityViolationException.class);
        jdbc.update("UPDATE alerts SET status='RESOLVED', resolved_at=now() + interval '1 minute' WHERE dedupe_key=?", "K:" + machine);
        jdbc.update(insert, machine, "LOW_STOCK", "K:" + machine, "OPEN", null);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM alerts WHERE dedupe_key=?", Long.class, "K:" + machine)).isEqualTo(2);
        jdbc.update(insert, machine, "HARDWARE_FAULT", "HW:" + machine, "OPEN", null);
        assertThatThrownBy(() -> jdbc.update(insert, machine, "NOT_A_TYPE", "X:" + machine, "OPEN", null)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO alerts (machine_id, slot_id, type, severity, title, dedupe_key) VALUES (?, ?, 'LOW_STOCK', 'INFO', 't', ?)",
                machine, otherSlot, "S:" + machine)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO alerts (machine_id, type, severity, title, dedupe_key, error_code) VALUES (?, 'HARDWARE_FAULT', 'INFO', 't', ?, 'bad-code')",
                machine, "E:" + machine)).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(jdbc.queryForList("SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id JOIN roles r ON r.id = rp.role_id WHERE r.name = 'STAFF' AND p.code LIKE 'ALERT_%' ORDER BY p.code",
                String.class)).containsExactly("ALERT_MANAGE", "ALERT_READ");
    }

    // ---- 10. health check ----

    @Test
    void offlineMachinesGetOneAlertThatResolvesWhenTheyComeBackAndInactiveMachinesAreSkipped() throws Exception {
        UUID machine = activeMachine(), inactive = activeMachine();
        seen(machine, now().minusSeconds(200));
        seen(inactive, now().minusSeconds(200));
        jdbc.update("UPDATE machines SET status='INACTIVE' WHERE id=?", inactive);
        runner.runOnce();
        runner.runOnce();
        assertThat(open(machine, "MACHINE_OFFLINE")).hasSize(1).first().satisfies(a -> assertThat(a.get("severity")).isEqualTo("WARNING"));
        assertThat(count(machine, "MACHINE_OFFLINE")).isEqualTo(1);
        assertThat(alerts(inactive)).isEmpty();
        seen(machine, now());
        runner.runOnce();
        assertThat(open(machine, "MACHINE_OFFLINE")).isEmpty();
        var resolved = alerts(machine).getFirst();
        assertThat(resolved.get("status")).isEqualTo("RESOLVED");
        assertThat(resolved.get("resolved_by")).isNull();
        assertThat(resolved.get("resolution_note")).isEqualTo("Condition cleared");
    }

    @Test
    void temperatureBreachAfterTheGraceIsCriticalAndStopsTheMachineAndBackInRangeResolvesIt() throws Exception {
        UUID machine = activeMachine();
        seen(machine, now());
        // fixtures.machine: 2..8 C, 40..80 %RH. Out of range for 4 minutes only: no alert yet.
        reading(machine, now().minus(Duration.ofMinutes(4)), "9.0", "60");
        reading(machine, now().minus(Duration.ofMinutes(1)), "9.5", "60");
        runner.runOnce();
        assertThat(count(machine, "HIGH_TEMPERATURE")).isZero();
        // An in-range reading inside the window restarts the run.
        reading(machine, now().minus(Duration.ofMinutes(7)), "9.1", "60");
        reading(machine, now().minus(Duration.ofMinutes(6)), "5.0", "60");
        runner.runOnce();
        assertThat(count(machine, "HIGH_TEMPERATURE")).isZero();
        clock.advance(Duration.ofMinutes(2));
        seen(machine, now());
        reading(machine, now(), "9.2", "60");
        runner.runOnce();
        assertThat(open(machine, "HIGH_TEMPERATURE")).hasSize(1).first().satisfies(a -> assertThat(a.get("severity")).isEqualTo("CRITICAL"));
        assertThat(machineStatus(machine)).isEqualTo("MAINTENANCE");
        assertThat(count(machine, "LOW_TEMPERATURE")).isZero();

        reading(machine, now(), "5.0", "60");
        runner.runOnce();
        assertThat(open(machine, "HIGH_TEMPERATURE")).isEmpty();
        assertThat(machineStatus(machine)).isEqualTo("MAINTENANCE");
    }

    @Test
    void lowTemperatureHumidityStaleReadingsAndASensorFault() throws Exception {
        UUID cold = activeMachine(), humid = activeMachine(), stale = activeMachine(), none = activeMachine(), faulty = activeMachine();
        for (UUID m : List.of(cold, humid, stale, none, faulty)) seen(m, now());
        reading(cold, now().minus(Duration.ofMinutes(10)), "1.0", null);
        reading(cold, now().minus(Duration.ofMinutes(1)), "0.5", null);
        reading(humid, now().minus(Duration.ofMinutes(10)), "5.0", "85");
        reading(humid, now().minus(Duration.ofMinutes(1)), "5.0", "90");
        // Out of range, but the latest reading is older than the offline threshold: not evaluated.
        reading(stale, now().minus(Duration.ofMinutes(20)), "20.0", null);
        reading(stale, now().minus(Duration.ofMinutes(4)), "20.0", null);
        reading(faulty, now().minus(Duration.ofMinutes(10)), "20.0", null);
        reading(faulty, now().minus(Duration.ofMinutes(1)), "20.0", null);
        event(faulty, "{\"eventType\":\"FAULT\",\"details\":{\"code\":\"TEMP_SENSOR_ERROR\"}}");
        runner.runOnce();
        assertThat(open(cold, "LOW_TEMPERATURE")).hasSize(1);
        assertThat(machineStatus(cold)).isEqualTo("MAINTENANCE");
        assertThat(open(humid, "HIGH_HUMIDITY")).hasSize(1).first().satisfies(a -> assertThat(a.get("severity")).isEqualTo("WARNING"));
        assertThat(machineStatus(humid)).isEqualTo("ACTIVE");
        assertThat(count(stale, "HIGH_TEMPERATURE")).isZero();
        assertThat(alerts(none)).isEmpty();
        assertThat(count(faulty, "HIGH_TEMPERATURE")).isZero();
        assertThat(open(faulty, "HARDWARE_FAULT")).hasSize(1).first().satisfies(a -> assertThat(a.get("error_code")).isEqualTo("TEMP_SENSOR_ERROR"));
    }

    @Test
    void lowStockAndExpiryFollowTheSlotContents() throws Exception {
        UUID machine = activeMachine();
        seen(machine, now());
        UUID slot = createSlot(machine, "A", 10), product = createProduct("Alert bowl", "10000");
        load(fixtures.batch(product, 2, staff.token()), slot, 2);
        runner.runOnce();
        assertThat(open(machine, "LOW_STOCK")).hasSize(1).first().satisfies(a -> assertThat(a.get("slot_id")).isEqualTo(slot));
        load(fixtures.batch(product, 1, staff.token()), slot, 1);
        runner.runOnce();
        assertThat(open(machine, "LOW_STOCK")).isEmpty();
        assertThat(count(machine, "PRODUCT_EXPIRING")).isZero();

        // A bowl expiring in 11 h (on top of the column), then another one already expired.
        UUID soon = shortBatch(product, 1, 11 * 3600);
        load(soon, slot, 1);
        runner.runOnce();
        assertThat(open(machine, "PRODUCT_EXPIRING")).hasSize(1).first().satisfies(a -> assertThat(a.get("severity")).isEqualTo("INFO"));
        jdbc.update("UPDATE product_batches SET expires_at = now() - interval '1 minute' WHERE id=?", soon);
        runner.runOnce();
        assertThat(open(machine, "PRODUCT_EXPIRED")).hasSize(1);
        assertThat(open(machine, "PRODUCT_EXPIRING")).isEmpty();
        jdbc.update("UPDATE inventory_items SET status='REMOVED', removed_at=now() WHERE batch_id=?", soon);
        runner.runOnce();
        assertThat(open(machine, "PRODUCT_EXPIRED")).isEmpty();
        assertThat(count(machine, "LOW_STOCK")).isEqualTo(1);
    }

    @Test
    void aFailingMachineDoesNotStopTheOthersAndOverlappingRunsAreSkipped() throws Exception {
        UUID broken = activeMachine(), healthy = activeMachine();
        seen(broken, now().minusSeconds(200));
        seen(healthy, now().minusSeconds(200));
        doThrow(new IllegalStateException("simulated")).when(queries).slots(eq(broken), any(), any(), any());
        assertThat(runner.runOnce()).isPositive();
        assertThat(open(healthy, "MACHINE_OFFLINE")).hasSize(1);
        // The broken machine's transaction rolled back as a whole.
        assertThat(alerts(broken)).isEmpty();

        var holding = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var pool = Executors.newSingleThreadExecutor();
        try {
            var other = pool.submit(() -> transactions.executeWithoutResult(s -> {
                jdbc.queryForObject("SELECT pg_try_advisory_xact_lock(?, ?)", Boolean.class, 0x46564D, 4);
                holding.countDown();
                try {
                    release.await(30, TimeUnit.SECONDS);
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                }
            }));
            assertThat(holding.await(10, TimeUnit.SECONDS)).isTrue();
            assertThat(runner.runOnce()).isEqualTo(MachineHealthCheckRunner.SKIPPED);
            release.countDown();
            other.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        assertThat(runner.runOnce()).isPositive();
    }

    // ---- 11. event-based alerts ----

    @Test
    void dispenseFailuresRaiseAlertsAndALateSuccessResolvesIt() throws Exception {
        PlacedOrder unsafe = paidOrder();
        dispense.handleMachineEvent(codeOf(unsafe.shop().machineId()), DispenseService.EVENT_ABORTED, commandCode(unsafe));
        var critical = open(unsafe.shop().machineId(), "DISPENSE_FAILED");
        assertThat(critical).hasSize(1).first().satisfies(a -> {
            assertThat(a.get("severity")).isEqualTo("CRITICAL");
            assertThat(a.get("error_code")).isEqualTo("ABORTED_UNSPECIFIED");
            assertThat(a.get("slot_id")).isEqualTo(unsafe.shop().slotId());
        });
        assertThat(notificationsOf(critical.getFirst().get("id"))).isEqualTo(notifiable());
        dispense.handleMachineEvent(codeOf(unsafe.shop().machineId()), DispenseService.EVENT_COMPLETED, commandCode(unsafe));
        assertThat(open(unsafe.shop().machineId(), "DISPENSE_FAILED")).isEmpty();

        PlacedOrder safe = paidOrder();
        dispense.handleMachineEvent(codeOf(safe.shop().machineId()), new DispenseReport(DispenseService.EVENT_REJECTED, commandCode(safe), "INVALID_COLUMN", null));
        assertThat(open(safe.shop().machineId(), "DISPENSE_FAILED")).hasSize(1).first().satisfies(a -> assertThat(a.get("severity")).isEqualTo("WARNING"));

        PlacedOrder several = paidOrder();
        dispense.handleMachineEvent(codeOf(several.shop().machineId()), new DispenseReport(DispenseService.EVENT_COMPLETED, commandCode(several), null, 2));
        assertThat(open(several.shop().machineId(), "HARDWARE_FAULT")).hasSize(1).first().satisfies(a -> {
            assertThat(a.get("severity")).isEqualTo("CRITICAL");
            assertThat(a.get("error_code")).isEqualTo("MULTIPLE_BOWLS_DETECTED");
        });
    }

    @Test
    void machineFaultsMapToSeverityAndMachineAction() throws Exception {
        String[][] cases = {{"SERVO_INIT_FAILED", "CRITICAL", "MAINTENANCE"}, {"GATE_POSITION_UNKNOWN", "CRITICAL", "MAINTENANCE"},
                {"CONTROLLER_FAULT", "CRITICAL", "MAINTENANCE"}, {"IR_SENSOR_STUCK", "WARNING", "MAINTENANCE"}, {"IR_SENSOR_DISCONNECTED", "WARNING", "MAINTENANCE"},
                {"UNEXPECTED_BOWL_DETECTED", "WARNING", "ACTIVE"}, {"TEMP_SENSOR_ERROR", "WARNING", "ACTIVE"}, {"NEW_FIRMWARE_CODE", "WARNING", "ACTIVE"}};
        for (String[] c : cases) {
            UUID machine = activeMachine();
            event(machine, "{\"eventType\":\"FAULT\",\"details\":{\"code\":\"" + c[0] + "\"}}");
            assertThat(open(machine, "HARDWARE_FAULT")).as(c[0]).hasSize(1).first().satisfies(a -> {
                assertThat(a.get("error_code")).isEqualTo(c[0]);
                assertThat(a.get("severity")).isEqualTo(c[1]);
            });
            assertThat(machineStatus(machine)).as(c[0]).isEqualTo(c[2]);
        }
        UUID invalid = activeMachine();
        event(invalid, "{\"eventType\":\"FAULT\",\"details\":{\"code\":\"bad code\"}}");
        event(invalid, "{\"eventType\":\"FAULT\",\"details\":{}}");
        assertThat(open(invalid, "HARDWARE_FAULT")).hasSize(1).first().satisfies(a -> assertThat(a.get("error_code")).isEqualTo("UNKNOWN_FAULT"));
    }

    @Test
    void bootFaultClearedAndRepeatedFaults() throws Exception {
        UUID machine = activeMachine();
        event(machine, "{\"eventType\":\"BOOT\",\"details\":{\"resetReason\":\"POWERON\"}}");
        assertThat(alerts(machine)).isEmpty();
        event(machine, "{\"eventType\":\"BOOT\",\"details\":{\"resetReason\":\"WATCHDOG\"}}");
        assertThat(open(machine, "HARDWARE_FAULT")).hasSize(1).first().satisfies(a -> {
            assertThat(a.get("error_code")).isEqualTo("REBOOT_WATCHDOG");
            assertThat(a.get("severity")).isEqualTo("WARNING");
        });
        // The same fault reported twice (and redelivered) is one alert with one round of notifications.
        String fault = "{\"eventType\":\"FAULT\",\"details\":{\"code\":\"CONTROLLER_FAULT\"}}";
        event(machine, fault);
        event(machine, fault);
        String code = codeOf(machine);
        byte[] same = ("{\"schemaVersion\":1,\"messageId\":\"dup-fault\",\"machineCode\":\"" + code + "\",\"payload\":" + fault + "}").getBytes(StandardCharsets.UTF_8);
        messages.handle(code, "events", same);
        messages.handle(code, "events", same);
        var controller = jdbc.queryForList("SELECT id FROM alerts WHERE machine_id=? AND error_code='CONTROLLER_FAULT'", UUID.class, machine);
        assertThat(controller).hasSize(1);
        assertThat(notificationsOf(controller.getFirst())).isEqualTo(notifiable());
        event(machine, "{\"eventType\":\"FAULT\",\"details\":{\"code\":\"IR_SENSOR_STUCK\"}}");
        event(machine, "{\"eventType\":\"FAULT_CLEARED\",\"details\":{\"code\":\"CONTROLLER_FAULT\"}}");
        assertThat(jdbc.queryForList("SELECT error_code FROM alerts WHERE machine_id=? AND type='HARDWARE_FAULT' AND status<>'RESOLVED' ORDER BY error_code", String.class, machine))
                .containsExactly("IR_SENSOR_STUCK", "REBOOT_WATCHDOG");
    }

    // ---- 12. notifications ----

    @Test
    void newAlertsNotifyAlertNotifyHoldersOnceAndTheNotificationApisWork() throws Exception {
        UUID machine = activeMachine();
        seen(machine, now().minusSeconds(200));
        runner.runOnce();
        UUID alert = jdbc.queryForObject("SELECT id FROM alerts WHERE machine_id=? AND type='MACHINE_OFFLINE'", UUID.class, machine);
        assertThat(notifiable()).isPositive();
        assertThat(notificationsOf(alert)).isEqualTo(notifiable());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM notifications WHERE user_id=?", Long.class, staff.id())).isZero();
        runner.runOnce();
        assertThat(notificationsOf(alert)).isEqualTo(notifiable());
        seen(machine, now());
        long before = jdbc.queryForObject("SELECT count(*) FROM notifications", Long.class);
        runner.runOnce();
        assertThat(open(machine, "MACHINE_OFFLINE")).isEmpty();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM notifications", Long.class)).isEqualTo(before);

        // The admin's own notifications.
        fixtures.api("POST", "/api/v1/notifications/me/read-all", null, admin.token(), 200);
        UUID second = raise(machine, AlertType.LOW_STOCK, AlertSeverity.WARNING, "NOTIFY-TEST:" + machine);
        assertThat(fixtures.api("GET", "/api/v1/notifications/me/unread-count", null, admin.token(), 200).path("unread").asLong()).isEqualTo(1);
        var unread = fixtures.api("GET", "/api/v1/notifications/me?unreadOnly=true", null, admin.token(), 200);
        assertThat(unread.path("totalElements").asLong()).isEqualTo(1);
        var item = unread.path("content").get(0);
        assertThat(item.fieldNames()).toIterable().containsExactlyInAnyOrder("id", "alertId", "workOrderId", "title", "message", "severity", "read", "readAt", "createdAt");
        assertThat(item.path("alertId").asText()).isEqualTo(second.toString());
        assertThat(item.path("read").asBoolean()).isFalse();
        String id = item.path("id").asText();
        assertThat(fixtures.api("POST", "/api/v1/notifications/" + id + "/read", null, admin.token(), 200).path("marked").asInt()).isEqualTo(1);
        assertThat(fixtures.api("POST", "/api/v1/notifications/" + id + "/read", null, admin.token(), 200).path("marked").asInt()).isZero();
        assertThat(fixtures.api("GET", "/api/v1/notifications/me/unread-count", null, admin.token(), 200).path("unread").asLong()).isZero();
        assertThat(fixtures.api("GET", "/api/v1/notifications/me?size=1", null, admin.token(), 200).path("content").get(0).path("read").asBoolean()).isTrue();
        raise(machine, AlertType.LOW_STOCK, AlertSeverity.WARNING, "NOTIFY-TEST-2:" + machine);
        assertThat(fixtures.api("POST", "/api/v1/notifications/me/read-all", null, admin.token(), 200).path("marked").asInt()).isEqualTo(1);

        // Someone else's notification does not exist for the caller; kiosk keys and anonymous callers are not users.
        fixtures.response("POST", "/api/v1/notifications/" + id + "/read", null, staff.token(), 404);
        fixtures.response("POST", "/api/v1/notifications/" + UUID.randomUUID() + "/read", null, admin.token(), 404);
        assertThat(fixtures.api("GET", "/api/v1/notifications/me", null, staff.token(), 200).path("totalElements").asLong()).isZero();
        fixtures.response("GET", "/api/v1/notifications/me", null, null, 401);
        fixtures.response("GET", "/api/v1/notifications/me?size=101", null, admin.token(), 400);
        assertThat(kioskCall("GET", "/api/v1/notifications/me/unread-count", issueKey(machine), null).getResponse().getStatus()).isEqualTo(401);
    }

    // ---- 13. alert APIs ----

    @Test
    void alertListFiltersSortsAndPagesAndTransitionsAreGuarded() throws Exception {
        UUID machine = activeMachine();
        UUID info = raise(machine, AlertType.PRODUCT_EXPIRING, AlertSeverity.INFO, "API-INFO:" + machine);
        clock.advance(Duration.ofSeconds(1));
        UUID critical = raise(machine, AlertType.HIGH_TEMPERATURE, AlertSeverity.CRITICAL, "API-CRIT:" + machine);
        clock.advance(Duration.ofSeconds(1));
        UUID warning = raise(machine, AlertType.LOW_STOCK, AlertSeverity.WARNING, "API-WARN:" + machine);
        String base = "/api/v1/alerts?machineId=" + machine;

        var list = fixtures.api("GET", base, null, staff.token(), 200);
        assertThat(list.path("content").findValuesAsText("id")).containsExactly(critical.toString(), warning.toString(), info.toString());
        var first = list.path("content").get(0);
        assertThat(first.path("machineCode").asText()).isEqualTo(codeOf(machine));
        assertThat(first.path("status").asText()).isEqualTo("OPEN");
        assertThat(fixtures.api("GET", base + "&severity=WARNING", null, staff.token(), 200).path("content").findValuesAsText("id")).containsExactly(warning.toString());
        assertThat(fixtures.api("GET", base + "&type=PRODUCT_EXPIRING", null, staff.token(), 200).path("totalElements").asLong()).isEqualTo(1);
        var page = fixtures.api("GET", base + "&size=2&page=1", null, staff.token(), 200);
        assertThat(page.path("content").findValuesAsText("id")).containsExactly(info.toString());
        assertThat(page.path("totalPages").asInt()).isEqualTo(2);

        var acknowledged = fixtures.api("POST", "/api/v1/alerts/" + warning + "/acknowledge", null, staff.token(), 200);
        assertThat(acknowledged.path("status").asText()).isEqualTo("ACKNOWLEDGED");
        assertThat(acknowledged.path("acknowledgedBy").asText()).contains("@");
        String at = acknowledged.path("acknowledgedAt").asText();
        assertThat(fixtures.api("POST", "/api/v1/alerts/" + warning + "/acknowledge", null, admin.token(), 200).path("acknowledgedAt").asText()).isEqualTo(at);
        var resolved = fixtures.api("POST", "/api/v1/alerts/" + warning + "/resolve", Map.of("note", "Refilled column A"), staff.token(), 200);
        assertThat(resolved.path("status").asText()).isEqualTo("RESOLVED");
        assertThat(resolved.path("resolutionNote").asText()).isEqualTo("Refilled column A");
        assertThat(resolved.path("resolvedBy").asText()).contains("@");
        fixtures.response("POST", "/api/v1/alerts/" + warning + "/resolve", null, staff.token(), 409);
        fixtures.response("POST", "/api/v1/alerts/" + warning + "/acknowledge", null, staff.token(), 409);
        assertThat(fixtures.api("POST", "/api/v1/alerts/" + info + "/resolve", null, admin.token(), 200).path("resolutionNote").isNull()).isTrue();
        // Default list shows unresolved alerts only; status=RESOLVED shows the others.
        assertThat(fixtures.api("GET", base, null, staff.token(), 200).path("content").findValuesAsText("id")).containsExactly(critical.toString());
        assertThat(fixtures.api("GET", base + "&status=RESOLVED", null, staff.token(), 200).path("totalElements").asLong()).isEqualTo(2);
        assertThat(fixtures.api("GET", "/api/v1/alerts/" + critical, null, staff.token(), 200).path("type").asText()).isEqualTo("HIGH_TEMPERATURE");

        for (String bad : List.of("?size=201", "?page=-1", "?status=CLOSED", "?machineId=nope", "?from=2026-11-13T00:00:00Z&to=2026-11-13T00:00:00Z"))
            fixtures.response("GET", "/api/v1/alerts" + bad, null, staff.token(), 400);
        fixtures.response("POST", "/api/v1/alerts/" + critical + "/resolve", Map.of("note", "x".repeat(501)), staff.token(), 400);
        fixtures.response("POST", "/api/v1/alerts/" + critical + "/resolve", Map.of("other", "x"), staff.token(), 400);
        fixtures.response("GET", "/api/v1/alerts/" + UUID.randomUUID(), null, staff.token(), 404);
        fixtures.response("POST", "/api/v1/alerts/" + UUID.randomUUID() + "/acknowledge", null, staff.token(), 404);

        fixtures.response("GET", "/api/v1/alerts", null, null, 401);
        assertThat(kioskCall("GET", "/api/v1/alerts", issueKey(machine), null).getResponse().getStatus()).isEqualTo(401);
        var reader = fixtures.staff(admin.token(), PASSWORD);
        UUID readOnly = UUID.randomUUID();
        jdbc.update("INSERT INTO roles (id, name, description) VALUES (?, ?, 'test only')", readOnly, "TEST_ALERT_READ_" + readOnly.toString().substring(0, 6).toUpperCase());
        jdbc.update("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE code='ALERT_READ'", readOnly);
        jdbc.update("DELETE FROM user_roles WHERE user_id=?", reader.id());
        jdbc.update("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", reader.id(), readOnly);
        fixtures.api("GET", base, null, reader.token(), 200);
        fixtures.response("POST", "/api/v1/alerts/" + critical + "/acknowledge", null, reader.token(), 403);
        jdbc.update("DELETE FROM user_roles WHERE user_id=?", reader.id());
        fixtures.response("GET", base, null, reader.token(), 403);
    }

    @Test
    void concurrentManualAndSystemResolutionResolveOnce() throws Exception {
        for (int round = 0; round < 5; round++) {
            UUID machine = activeMachine();
            String key = "RACE:" + machine;
            UUID alert = raise(machine, AlertType.MACHINE_OFFLINE, AlertSeverity.WARNING, key);
            var go = new CountDownLatch(1);
            var pool = Executors.newFixedThreadPool(2);
            try {
                var manual = pool.submit(() -> {
                    go.await();
                    return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/v1/alerts/" + alert + "/resolve")
                            .header("Authorization", "Bearer " + staff.token())).andReturn().getResponse().getStatus();
                });
                var system = pool.submit(() -> { go.await(); return transactions.execute(s -> alertService.autoResolve(key, now())); });
                go.countDown();
                // Either the user wins (200) or the system resolved it first (409); never an error.
                assertThat(manual.get(30, TimeUnit.SECONDS)).isIn(200, 409);
                system.get(30, TimeUnit.SECONDS);
            } finally {
                pool.shutdownNow();
            }
            var rows = jdbc.queryForList("SELECT status, resolved_at, resolved_by FROM alerts WHERE dedupe_key=?", key);
            assertThat(rows).hasSize(1).first().satisfies(r -> {
                assertThat(r.get("status")).isEqualTo("RESOLVED");
                assertThat(r.get("resolved_at")).isNotNull();
            });
        }
    }

    // ---- fixtures ----

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
