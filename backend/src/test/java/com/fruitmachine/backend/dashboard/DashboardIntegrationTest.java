package com.fruitmachine.backend.dashboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.support.AbstractOrderIntegrationTest;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/** Issue #76 §10-§11: dashboard counts (as deltas over this test's fixtures), money only for REPORT_SALES_READ, statement count. */
@Import(DashboardIntegrationTest.StatementCounter.class)
class DashboardIntegrationTest extends AbstractOrderIntegrationTest {
    static final String OVERVIEW = "/api/v1/dashboard/overview";

    @Test
    void countsFollowTheFixturesAndStaffSeesNoMoney() throws Exception {
        JsonNode before = overview(admin.token());
        Instant now = clock.instant();

        // Machines: A ACTIVE + ONLINE, B MAINTENANCE + never seen, C INACTIVE (never activated) + OFFLINE.
        UUID a = fixtures.machine(admin.token()), b = fixtures.machine(admin.token());
        UUID c = TestIds.id(fixtures.api("POST", "/api/v1/machines", Map.of("code", "DASH-" + UUID.randomUUID(), "name", "Dashboard C",
                "location", "Test", "minTemperature", 2, "maxTemperature", 8, "minHumidity", 40, "maxHumidity", 80), admin.token(), 201));
        jdbc.update("UPDATE machines SET status='MAINTENANCE' WHERE id=?", b);
        jdbc.update("UPDATE machines SET last_seen_at=? WHERE id=?", Timestamp.from(now.minusSeconds(5)), a);
        jdbc.update("UPDATE machines SET last_seen_at=? WHERE id=?", Timestamp.from(now.minusSeconds(600)), c);
        jdbc.update("INSERT INTO sensor_readings (machine_id, temperature, recorded_at) VALUES (?, 5.0, ?), (?, 4.2, ?)",
                a, Timestamp.from(now.minusSeconds(120)), a, Timestamp.from(now.minusSeconds(30)));

        // Stock of A: slot A one bowl (low stock), slot B three bowls; one more bowl in slot B of B expires in 2 minutes.
        UUID product = createProduct("Dưa hấu dashboard", "35000");
        UUID slotA = createSlot(a, "A", 10), slotB = createSlot(a, "B", 10);
        load(fixtures.batch(product, 1, staff.token()), slotA, 1);
        load(fixtures.batch(product, 3, staff.token()), slotB, 3);
        UUID bSlot = createSlot(b, "A", 10);
        load(shortBatch(product, 1, 120), bSlot, 1);
        UUID bSlotB = createSlot(b, "B", 10);
        jdbc.update("UPDATE machine_slots SET status='ERROR' WHERE id=?", bSlotB);

        // Alerts: critical + warning open on A, an info alert resolved.
        alert(a, "HIGH_TEMPERATURE", "CRITICAL", "OPEN");
        alert(a, "LOW_STOCK", "WARNING", "OPEN");
        alert(a, "PRODUCT_EXPIRING", "INFO", "RESOLVED");

        // Work orders: one OPEN, one ASSIGNED to staff and overdue, one IN_PROGRESS by staff.
        UUID open = workOrder(a);
        UUID assigned = workOrder(a);
        assign(assigned);
        jdbc.update("UPDATE work_orders SET due_at=? WHERE id=?", Timestamp.from(now.minusSeconds(3600)), assigned);
        UUID started = workOrder(a);
        assign(started);
        fixtures.api("POST", "/api/v1/work-orders/" + started + "/start", Map.of(), staff.token(), 200);

        // Money: one sale today and one yesterday on A (business days), one failed paid order (refund candidate).
        sale(a, product, 35000, now.minusSeconds(60));
        sale(a, product, 20000, calendarYesterday());
        UUID failed = order(a, product, 30000, "DISPENSE_FAILED", now.minusSeconds(90), null);

        JsonNode after = overview(admin.token());
        assertThat(delta(before, after, "/machines/total")).isEqualTo(3);
        assertThat(delta(before, after, "/machines/active")).isEqualTo(1);
        assertThat(delta(before, after, "/machines/maintenance")).isEqualTo(1);
        assertThat(delta(before, after, "/machines/inactive")).isEqualTo(1);
        assertThat(delta(before, after, "/machines/online")).isEqualTo(1);
        assertThat(delta(before, after, "/machines/offline")).isEqualTo(1);
        assertThat(delta(before, after, "/machines/neverSeen")).isEqualTo(1);
        assertThat(delta(before, after, "/alerts/open")).isEqualTo(2);
        assertThat(delta(before, after, "/alerts/critical")).isEqualTo(1);
        assertThat(delta(before, after, "/alerts/warning")).isEqualTo(1);
        assertThat(delta(before, after, "/alerts/info")).isZero();
        assertThat(delta(before, after, "/workOrders/open")).isEqualTo(2);
        assertThat(delta(before, after, "/workOrders/inProgress")).isEqualTo(1);
        assertThat(delta(before, after, "/workOrders/overdue")).isEqualTo(1);
        assertThat(after.at("/workOrders/assignedToMe").asLong()).isZero();
        assertThat(delta(before, after, "/stock/lowStockSlots")).isEqualTo(2); // A/A (1 bowl) and B/A (bowl not sellable within the hold)
        assertThat(delta(before, after, "/stock/blockedSlots")).isEqualTo(1);
        assertThat(delta(before, after, "/stock/bowlsExpiringToday")).isEqualTo(1);
        assertThat(delta(before, after, "/today/ordersSold")).isEqualTo(1);
        assertThat(delta(before, after, "/today/netSales")).isEqualTo(35000);
        assertThat(delta(before, after, "/today/yesterdayNetSales")).isEqualTo(20000);
        assertThat(after.at("/today/date").asText()).isEqualTo(java.time.LocalDate.ofInstant(now, java.time.ZoneId.of("Asia/Ho_Chi_Minh")).toString());
        assertThat(delta(before, after, "/refunds/pendingCount")).isEqualTo(1);
        assertThat(delta(before, after, "/refunds/pendingAmount")).isEqualTo(30000);
        assertThat(failed).isNotNull();

        JsonNode detailA = machine(after, a);
        assertThat(detailA.path("status").asText()).isEqualTo("ACTIVE");
        assertThat(detailA.path("connectivity").asText()).isEqualTo("ONLINE");
        assertThat(detailA.path("temperature").decimalValue()).isEqualByComparingTo("4.2");
        assertThat(detailA.path("sellableBowls").asLong()).isEqualTo(4);
        assertThat(detailA.path("openAlerts").asLong()).isEqualTo(2);
        assertThat(machine(after, b).path("connectivity").asText()).isEqualTo("NEVER_SEEN");
        assertThat(machine(after, b).path("temperature").isNull()).isTrue();
        assertThat(machine(after, c).path("connectivity").asText()).isEqualTo("OFFLINE");
        assertThat(machine(after, c).path("status").asText()).isEqualTo("INACTIVE");

        JsonNode staffView = overview(staff.token());
        assertThat(staffView.has("today")).isFalse();
        assertThat(staffView.has("refunds")).isFalse();
        assertThat(staffView.at("/workOrders/assignedToMe").asLong()).isEqualTo(after.at("/workOrders/assignedToMe").asLong() + 2);
        assertThat(staffView.path("machinesDetail")).hasSize(after.path("machinesDetail").size());
        assertThat(staffView.toString()).doesNotContain("netSales", "pendingAmount");
        assertThat(open).isNotNull();
    }

    @Test
    void theOverviewUsesAFixedSmallNumberOfStatements() throws Exception {
        for (int i = 0; i < 3; i++) fixtures.machine(admin.token());
        overview(admin.token()); // warm up
        StatementCounter.COUNTING.set(true);
        StatementCounter.COUNT.set(0);
        try {
            overview(admin.token());
        } finally {
            StatementCounter.COUNTING.set(false);
        }
        int withThree = StatementCounter.COUNT.get();
        for (int i = 0; i < 5; i++) fixtures.machine(admin.token());
        StatementCounter.COUNTING.set(true);
        StatementCounter.COUNT.set(0);
        try {
            overview(admin.token());
        } finally {
            StatementCounter.COUNTING.set(false);
        }
        // Whole request (authentication included): at most 10 statements, independent of the number of machines.
        assertThat(withThree).as("the counter sees the request's statements").isGreaterThanOrEqualTo(6);
        assertThat(StatementCounter.COUNT.get()).isLessThanOrEqualTo(10).isEqualTo(withThree);
    }

    @Test
    void accessRules() throws Exception {
        fixtures.response("GET", OVERVIEW, null, staff.token(), 200);
        fixtures.response("GET", OVERVIEW, null, null, 401);
        UUID machine = fixtures.machine(admin.token());
        assertThat(kioskCall("GET", OVERVIEW, issueKey(machine), null).getResponse().getStatus()).isEqualTo(401);
    }

    // ---- helpers ----

    private JsonNode overview(String token) throws Exception {
        var response = mvc.perform(get(OVERVIEW).header("Authorization", "Bearer " + token)).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        return json.readTree(response.getContentAsString()).path("data");
    }

    private static long delta(JsonNode before, JsonNode after, String pointer) {
        return after.at(pointer).asLong() - before.at(pointer).asLong();
    }

    private static JsonNode machine(JsonNode overview, UUID id) {
        for (JsonNode m : overview.path("machinesDetail")) if (m.path("machineId").asText().equals(id.toString())) return m;
        throw new AssertionError("machine " + id + " missing");
    }

    private void alert(UUID machine, String type, String severity, String status) {
        Instant now = clock.instant();
        jdbc.update("INSERT INTO alerts (machine_id, type, severity, title, status, triggered_at, resolved_at, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                machine, type, severity, "Dashboard " + type, status, Timestamp.from(now.minusSeconds(60)),
                status.equals("RESOLVED") ? Timestamp.from(now) : null, "DASH:" + UUID.randomUUID());
    }

    private UUID workOrder(UUID machine) throws Exception {
        return TestIds.id(fixtures.api("POST", "/api/v1/work-orders", Map.of("type", "INCIDENT", "machineId", machine, "title", "Dashboard work"),
                admin.token(), 201));
    }

    private void assign(UUID workOrder) throws Exception {
        fixtures.api("POST", "/api/v1/work-orders/" + workOrder + "/assign", Map.of("assigneeId", staff.id(), "version",
                jdbc.queryForObject("SELECT version FROM work_orders WHERE id=?", Long.class, workOrder)), admin.token(), 200);
    }

    private Instant calendarYesterday() {
        var zone = java.time.ZoneId.of("Asia/Ho_Chi_Minh");
        return java.time.LocalDate.ofInstant(clock.instant(), zone).minusDays(1).atTime(12, 0).atZone(zone).toInstant();
    }

    private void sale(UUID machine, UUID product, int amount, Instant completedAt) {
        order(machine, product, amount, "COMPLETED", completedAt.minusSeconds(30), completedAt);
    }

    private UUID order(UUID machine, UUID product, int amount, String status, Instant paidAt, Instant completedAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO orders (id, order_code, machine_id, status, subtotal, total_amount, created_at, paid_at, completed_at)"
                + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", id, "ORD-DASH-" + id.toString().substring(0, 8).toUpperCase(), machine, status, amount, amount,
                Timestamp.from(paidAt.minusSeconds(30)), Timestamp.from(paidAt), completedAt == null ? null : Timestamp.from(completedAt));
        jdbc.update("INSERT INTO order_items (order_id, product_id, quantity, original_unit_price, unit_price, total_price) VALUES (?, ?, 1, ?, ?, ?)",
                id, product, amount, amount, amount);
        jdbc.update("INSERT INTO payments (order_id, provider, transaction_id, payment_reference, amount, status, created_at, paid_at)"
                + " VALUES (?, 'TESTPAY', ?, ?, ?, 'SUCCESS', ?, ?)", id, "TX-" + id, "REF-" + id, amount, Timestamp.from(paidAt.minusSeconds(10)),
                Timestamp.from(paidAt));
        return id;
    }

    private static final class TestIds {
        static UUID id(JsonNode node) {
            return UUID.fromString(node.path("id").asText());
        }
    }

    /** Counts JDBC statements prepared on the current thread while COUNTING is set (wraps the DataSource of this test context). */
    @TestConfiguration(proxyBeanMethods = false)
    static class StatementCounter {
        static final ThreadLocal<Boolean> COUNTING = ThreadLocal.withInitial(() -> false);
        static final AtomicInteger COUNT = new AtomicInteger();

        @Bean
        static BeanPostProcessor countingDataSource() {
            return new BeanPostProcessor() {
                @Override
                public Object postProcessAfterInitialization(Object bean, String name) {
                    if (!(bean instanceof DataSource dataSource)) return bean;
                    return Proxy.newProxyInstance(DataSource.class.getClassLoader(), new Class<?>[]{DataSource.class}, (proxy, method, args) -> {
                        Object result = invoke(method, dataSource, args);
                        return result instanceof Connection connection ? counting(connection) : result;
                    });
                }
            };
        }

        private static Connection counting(Connection connection) {
            return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[]{Connection.class}, (proxy, method, args) -> {
                String name = method.getName();
                if (COUNTING.get() && (name.equals("prepareStatement") || name.equals("createStatement") || name.equals("prepareCall"))) COUNT.incrementAndGet();
                return invoke(method, connection, args);
            });
        }

        private static Object invoke(java.lang.reflect.Method method, Object target, Object[] args) throws Throwable {
            try {
                return method.invoke(target, args);
            } catch (InvocationTargetException ex) {
                throw ex.getCause();
            }
        }
    }
}
