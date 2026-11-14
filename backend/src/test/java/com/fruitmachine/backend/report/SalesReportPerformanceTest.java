package com.fruitmachine.backend.report;

import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/**
 * Issue #76 §12: 100 000 completed orders over one year on two machines (with payments, items and some refunds) seeded in SQL; each
 * report endpoint is timed after a warm-up and must meet the targets (summary < 500 ms, other reports < 1 s, one-year export < 5 s).
 * Timings and EXPLAIN ANALYZE of the main aggregate are written to target/report-performance.txt for the PR.
 */
class SalesReportPerformanceTest extends AbstractCoreIntegrationTest {
    static final int ORDERS = 100_000;

    @Test
    void reportsMeetTheTargetsOnOneHundredThousandOrders() throws Exception {
        UUID m1 = fixtures.machine(admin.token()), m2 = fixtures.machine(admin.token());
        UUID p1 = UUID.randomUUID(), p2 = UUID.randomUUID();
        jdbc.update("INSERT INTO products (id, sku, name, price, status) VALUES (?, 'PERF-1', 'Dưa hấu', 35000, 'ACTIVE'), (?, 'PERF-2', 'Táo', 20000, 'ACTIVE')", p1, p2);
        long seedStart = System.nanoTime();
        jdbc.update("""
                INSERT INTO orders (id, order_code, machine_id, status, subtotal, discount_amount, total_amount, created_at, paid_at, completed_at)
                SELECT md5(n::text)::uuid, 'ORD-PERF-' || n, CASE WHEN n % 2 = 0 THEN ?::uuid ELSE ?::uuid END, 'COMPLETED',
                       CASE WHEN n % 3 = 0 THEN 20000 ELSE 35000 END, CASE WHEN n % 10 = 0 THEN 5000 ELSE 0 END,
                       CASE WHEN n % 3 = 0 THEN 20000 ELSE 35000 END - CASE WHEN n % 10 = 0 THEN 5000 ELSE 0 END,
                       t - interval '2 minutes', t - interval '1 minute', t
                FROM generate_series(1, ?) AS n, LATERAL (SELECT timestamptz '2025-01-01 01:00:00+00' + (n * interval '315 seconds') AS t) x""",
                m1, m2, ORDERS);
        jdbc.update("""
                INSERT INTO order_items (order_id, product_id, quantity, original_unit_price, unit_price, total_price, discount_percent, discount_reason)
                SELECT o.id, CASE WHEN o.subtotal = 20000 THEN ?::uuid ELSE ?::uuid END, 1, o.subtotal, o.total_amount, o.total_amount,
                       CASE WHEN o.discount_amount > 0 THEN 15 ELSE 0 END, CASE WHEN o.discount_amount > 0 THEN 'NEAR_EXPIRY' ELSE 'NONE' END
                FROM orders o WHERE o.order_code LIKE 'ORD-PERF-%'""", p2, p1);
        jdbc.update("""
                INSERT INTO payments (order_id, provider, transaction_id, payment_reference, amount, status, created_at, paid_at)
                SELECT o.id, 'TESTPAY', 'TX-' || o.order_code, 'REF-' || o.order_code, o.total_amount, 'SUCCESS', o.paid_at - interval '10 seconds', o.paid_at
                FROM orders o WHERE o.order_code LIKE 'ORD-PERF-%'""");
        jdbc.update("""
                UPDATE payments p SET status = 'REFUNDED', refunded_at = p.paid_at + interval '1 day', refunded_by = ?, refund_reason = 'PRODUCT_QUALITY',
                       refund_transfer_ref = 'FT-' || substr(p.id::text, 1, 18)
                FROM orders o WHERE o.id = p.order_id AND o.order_code LIKE 'ORD-PERF-%' AND right(o.order_code, 3) = '777'""", admin.id());
        jdbc.update("UPDATE orders o SET status = 'REFUNDED', refunded_at = p.refunded_at FROM payments p WHERE p.order_id = o.id AND p.status = 'REFUNDED'"
                + " AND o.order_code LIKE 'ORD-PERF-%'");
        jdbc.execute("ANALYZE orders");
        jdbc.execute("ANALYZE payments");
        jdbc.execute("ANALYZE order_items");
        long seedMillis = (System.nanoTime() - seedStart) / 1_000_000;
        assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE order_code LIKE 'ORD-PERF-%'", Long.class)).isEqualTo(ORDERS);

        String year = "?from=2025-01-01&to=2025-12-31";
        Map<String, String> endpoints = new LinkedHashMap<>();
        endpoints.put("summary one day", "/api/v1/reports/sales/summary?from=2025-06-01&to=2025-06-01");
        endpoints.put("refund candidates", "/api/v1/refunds/candidates?size=1");
        endpoints.put("summary", "/api/v1/reports/sales/summary" + year);
        endpoints.put("timeseries DAY", "/api/v1/reports/sales/timeseries" + year);
        endpoints.put("timeseries MONTH", "/api/v1/reports/sales/timeseries" + year + "&granularity=MONTH");
        endpoints.put("peak-hours", "/api/v1/reports/sales/peak-hours" + year);
        endpoints.put("products", "/api/v1/reports/sales/products" + year + "&limit=100");
        endpoints.put("machines", "/api/v1/reports/sales/machines" + year);
        endpoints.put("summary (machine + product)", "/api/v1/reports/sales/summary" + year + "&machineId=" + m1 + "&productId=" + p1);
        endpoints.put("export CSV", "/api/v1/reports/sales/export" + year + "&format=CSV");
        endpoints.put("export PDF", "/api/v1/reports/sales/export" + year + "&format=PDF");

        List<String> lines = new ArrayList<>();
        lines.add("Issue #76 report performance: " + ORDERS + " completed orders in 2025 on 2 machines, seeded in " + seedMillis + " ms");
        for (var entry : endpoints.entrySet()) {
            call(entry.getValue()); // warm-up
            long best = Long.MAX_VALUE;
            for (int i = 0; i < 3; i++) {
                long start = System.nanoTime();
                call(entry.getValue());
                best = Math.min(best, (System.nanoTime() - start) / 1_000_000);
            }
            lines.add(String.format("%-30s %6d ms (best of 3, whole HTTP request)", entry.getKey(), best));
            long limit = entry.getKey().startsWith("summary") ? 500 : entry.getKey().startsWith("export") ? 5000 : 1000;
            if (Boolean.getBoolean("perf.measureOnly")) continue;
            assertThat(best).as(entry.getKey()).isLessThan(limit);
        }
        lines.add("");
        lines.add("EXPLAIN ANALYZE (sold orders of the year, machine filter):");
        lines.addAll(jdbc.queryForList("EXPLAIN (ANALYZE, BUFFERS) SELECT count(*), sum(o.subtotal), sum(o.discount_amount), sum(o.total_amount) FROM orders o"
                + " WHERE o.completed_at >= '2024-12-31 17:00:00+00' AND o.completed_at < '2025-12-31 17:00:00+00' AND o.machine_id = '" + m1 + "'", String.class));
        Files.createDirectories(Path.of("target"));
        Files.write(Path.of("target/report-performance.txt"), lines);
        lines.forEach(System.out::println);

        var summary = fixtures.api("GET", "/api/v1/reports/sales/summary" + year + "&machineId=" + m1 + "&machineId=" + m2, null, admin.token(), 200);
        assertThat(summary.path("ordersSold").asLong()).isEqualTo(jdbc.queryForObject(
                "SELECT count(*) FROM orders WHERE order_code LIKE 'ORD-PERF-%' AND completed_at >= '2024-12-31 17:00:00+00' AND completed_at < '2025-12-31 17:00:00+00'", Long.class));
    }

    private void call(String path) throws Exception {
        var response = mvc.perform(get(path).header("Authorization", "Bearer " + admin.token())).andReturn().getResponse();
        assertThat(response.getStatus()).as(path).isEqualTo(200);
    }
}
