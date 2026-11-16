package com.fruitmachine.backend.report.repository;

import com.fruitmachine.backend.report.model.ReportFilters;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Aggregate SQL of the sales reports (issue #76): every figure is summed in PostgreSQL; Java only fills empty buckets.
 * Definitions (docs/reports.md): a sale is an order with completed_at in range; delivered refunds are REFUNDED payments of completed
 * orders with reason PRODUCT_QUALITY / OTHER by refunded_at in range; buckets and hours use the business zone.
 */
@Repository
@RequiredArgsConstructor
public class SalesReportQueries {
    /** Delivered-order refunds (the paying payment of a completed order; RefundService allows these reasons only on it). */
    private static final String DELIVERED_REFUND = "p.status = 'REFUNDED' AND o.completed_at IS NOT NULL AND p.refund_reason IN ('PRODUCT_QUALITY', 'OTHER')";
    private final NamedParameterJdbcTemplate jdbc;

    public record Totals(long ordersSold, long grossSales, long discounts, long netSales, long deliveredRefunds, long moneyCollected, long failedDispenses) {
    }

    /** One statement, each source scanned once (CTEs); the failed-dispense evidence is a hashed semi-join, not a per-order subquery. */
    public Totals totals(ReportFilters filters) {
        String f = filter(filters);
        return jdbc.queryForObject("WITH sold AS (SELECT count(*) AS c, coalesce(sum(o.subtotal), 0) AS g, coalesce(sum(o.discount_amount), 0) AS d,"
                + "   coalesce(sum(o.total_amount), 0) AS n FROM orders o WHERE o.completed_at >= :start AND o.completed_at < :end" + f + "),"
                + " delivered AS (SELECT coalesce(sum(p.amount), 0) AS r FROM payments p JOIN orders o ON o.id = p.order_id WHERE " + DELIVERED_REFUND
                + "   AND p.refunded_at >= :start AND p.refunded_at < :end" + f + "),"
                + " collected AS (SELECT coalesce(sum(p.amount), 0) AS m FROM payments p JOIN orders o ON o.id = p.order_id"
                + "   WHERE p.status IN ('SUCCESS', 'REFUNDED') AND p.paid_at >= :start AND p.paid_at < :end" + f + "),"
                + " failed AS (SELECT count(*) AS x FROM orders o WHERE o.paid_at >= :start AND o.paid_at < :end" + f
                + "   AND (o.status = 'DISPENSE_FAILED' OR (o.status = 'REFUNDED' AND o.completed_at IS NULL AND o.cancelled_at IS NULL)"
                + "        OR o.id IN (SELECT c.order_id FROM dispense_commands c WHERE c.status IN ('FAILED', 'TIMEOUT'))))"
                + " SELECT sold.c, sold.g, sold.d, sold.n, delivered.r, collected.m, failed.x FROM sold, delivered, collected, failed",
                params(filters), (rs, row) -> new Totals(rs.getLong(1), money(rs.getBigDecimal(2)), money(rs.getBigDecimal(3)), money(rs.getBigDecimal(4)),
                        money(rs.getBigDecimal(5)), money(rs.getBigDecimal(6)), rs.getLong(7)));
    }

    /** Net sales only (the denominator of product shares). */
    public long netSales(ReportFilters filters) {
        return money(jdbc.queryForObject("SELECT coalesce(sum(o.total_amount), 0) FROM orders o WHERE o.completed_at >= :start AND o.completed_at < :end"
                + filter(filters), params(filters), BigDecimal.class));
    }

    /** REFUNDED payments by refunded_at in range, per reason (all refunds: delivered, failed, late, duplicate). */
    public Map<String, Long> refundsByReason(ReportFilters filters) {
        var result = new java.util.LinkedHashMap<String, Long>();
        jdbc.query("SELECT p.refund_reason, coalesce(sum(p.amount), 0) FROM payments p JOIN orders o ON o.id = p.order_id"
                + " WHERE p.status = 'REFUNDED' AND p.refunded_at >= :start AND p.refunded_at < :end" + filter(filters) + " GROUP BY p.refund_reason",
                params(filters), rs -> {
                    result.put(rs.getString(1), money(rs.getBigDecimal(2)));
                });
        return result;
    }

    public record BucketRow(LocalDate bucket, long ordersSold, long grossSales, long discounts, long netSales) {
    }

    /** Sales per bucket start (date_trunc day / week / month of completed_at in the business zone). */
    public List<BucketRow> salesBuckets(ReportFilters filters, String unit) {
        return jdbc.query("SELECT date_trunc(:unit, o.completed_at AT TIME ZONE :zone)::date AS bucket, count(*), sum(o.subtotal), sum(o.discount_amount),"
                + " sum(o.total_amount) FROM orders o WHERE o.completed_at >= :start AND o.completed_at < :end" + filter(filters) + " GROUP BY 1",
                params(filters).addValue("unit", unit), (rs, row) -> new BucketRow(rs.getObject(1, LocalDate.class), rs.getLong(2),
                        money(rs.getBigDecimal(3)), money(rs.getBigDecimal(4)), money(rs.getBigDecimal(5))));
    }

    /** Delivered refunds per bucket start of refunded_at. */
    public Map<LocalDate, Long> refundBuckets(ReportFilters filters, String unit) {
        var result = new java.util.HashMap<LocalDate, Long>();
        jdbc.query("SELECT date_trunc(:unit, p.refunded_at AT TIME ZONE :zone)::date, coalesce(sum(p.amount), 0) FROM payments p JOIN orders o ON o.id = p.order_id"
                + " WHERE " + DELIVERED_REFUND + " AND p.refunded_at >= :start AND p.refunded_at < :end" + filter(filters) + " GROUP BY 1",
                params(filters).addValue("unit", unit), rs -> {
                    result.put(rs.getObject(1, LocalDate.class), money(rs.getBigDecimal(2)));
                });
        return result;
    }

    public record HourRow(int isoWeekday, int hour, long ordersSold, long netSales) {
    }

    public List<HourRow> hours(ReportFilters filters) {
        return jdbc.query("SELECT extract(isodow FROM o.completed_at AT TIME ZONE :zone)::int, extract(hour FROM o.completed_at AT TIME ZONE :zone)::int,"
                + " count(*), sum(o.total_amount) FROM orders o WHERE o.completed_at >= :start AND o.completed_at < :end" + filter(filters) + " GROUP BY 1, 2",
                params(filters), (rs, row) -> new HourRow(rs.getInt(1), rs.getInt(2), rs.getLong(3), money(rs.getBigDecimal(4))));
    }

    public record ProductRow(UUID productId, String sku, String name, String status, long quantity, long grossSales, long discounts, long netSales,
            long deliveredRefunds) {
    }

    /** Products with sales or delivered refunds in range; sorted in SQL; limit null = all. */
    public List<ProductRow> products(ReportFilters filters, boolean byQuantity, Integer limit) {
        String f = filter(filters);
        String sql = "WITH sold AS (SELECT oi.product_id, sum(oi.quantity) AS q, sum(o.subtotal) AS g, sum(o.discount_amount) AS d, sum(o.total_amount) AS n"
                + "   FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.completed_at >= :start AND o.completed_at < :end" + f + " GROUP BY oi.product_id),"
                + " refunded AS (SELECT oi.product_id, sum(p.amount) AS r FROM payments p JOIN orders o ON o.id = p.order_id JOIN order_items oi ON oi.order_id = o.id"
                + "   WHERE " + DELIVERED_REFUND + " AND p.refunded_at >= :start AND p.refunded_at < :end" + f + " GROUP BY oi.product_id)"
                + " SELECT pr.id, pr.sku, pr.name, pr.status, coalesce(s.q, 0), coalesce(s.g, 0), coalesce(s.d, 0), coalesce(s.n, 0), coalesce(r.r, 0)"
                + " FROM products pr LEFT JOIN sold s ON s.product_id = pr.id LEFT JOIN refunded r ON r.product_id = pr.id"
                + " WHERE s.product_id IS NOT NULL OR r.product_id IS NOT NULL"
                + " ORDER BY " + (byQuantity ? "coalesce(s.q, 0) DESC" : "coalesce(s.n, 0) DESC") + ", pr.name, pr.id"
                + (limit == null ? "" : " LIMIT :limit");
        return jdbc.query(sql, params(filters).addValue("limit", limit), (rs, row) -> new ProductRow(rs.getObject(1, UUID.class), rs.getString(2),
                rs.getString(3), rs.getString(4), rs.getLong(5), money(rs.getBigDecimal(6)), money(rs.getBigDecimal(7)), money(rs.getBigDecimal(8)),
                money(rs.getBigDecimal(9))));
    }

    public record MachineRow(UUID machineId, String code, String name, long ordersSold, long netSales, long deliveredRefunds) {
    }

    /** Every machine (of the machine filter, if any), with zeros where nothing was sold; by netSales, then code. */
    public List<MachineRow> machines(ReportFilters filters) {
        String f = filter(filters);
        return jdbc.query("WITH sold AS (SELECT o.machine_id, count(*) AS c, sum(o.total_amount) AS n FROM orders o"
                + "   WHERE o.completed_at >= :start AND o.completed_at < :end" + f + " GROUP BY o.machine_id),"
                + " refunded AS (SELECT o.machine_id, sum(p.amount) AS r FROM payments p JOIN orders o ON o.id = p.order_id"
                + "   WHERE " + DELIVERED_REFUND + " AND p.refunded_at >= :start AND p.refunded_at < :end" + f + " GROUP BY o.machine_id)"
                + " SELECT m.id, m.code, m.name, coalesce(s.c, 0), coalesce(s.n, 0), coalesce(r.r, 0) FROM machines m"
                + " LEFT JOIN sold s ON s.machine_id = m.id LEFT JOIN refunded r ON r.machine_id = m.id"
                + (filters.machineIds().isEmpty() ? "" : " WHERE m.id IN (:machineIds)")
                + " ORDER BY coalesce(s.n, 0) DESC, m.code, m.id",
                params(filters), (rs, row) -> new MachineRow(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getLong(4),
                        money(rs.getBigDecimal(5)), money(rs.getBigDecimal(6))));
    }

    public List<UUID> existingMachines(List<UUID> ids) {
        return ids.isEmpty() ? List.of() : jdbc.queryForList("SELECT id FROM machines WHERE id IN (:ids)", Map.of("ids", ids), UUID.class);
    }

    public List<UUID> existingProducts(List<UUID> ids) {
        return ids.isEmpty() ? List.of() : jdbc.queryForList("SELECT id FROM products WHERE id IN (:ids)", Map.of("ids", ids), UUID.class);
    }

    /** Machine and product filters on an order aliased {@code o}. */
    private static String filter(ReportFilters filters) {
        String sql = "";
        if (!filters.machineIds().isEmpty()) sql += " AND o.machine_id IN (:machineIds)";
        if (!filters.productIds().isEmpty()) sql += " AND EXISTS (SELECT 1 FROM order_items fi WHERE fi.order_id = o.id AND fi.product_id IN (:productIds))";
        return sql;
    }

    private static MapSqlParameterSource params(ReportFilters filters) {
        return new MapSqlParameterSource().addValue("start", Timestamp.from(filters.start())).addValue("end", Timestamp.from(filters.end()))
                .addValue("zone", filters.zone()).addValue("machineIds", filters.machineIds()).addValue("productIds", filters.productIds());
    }

    /** Whole VND (amounts are stored with 2 decimals; prices are whole). */
    static long money(BigDecimal value) {
        return value == null ? 0 : value.setScale(0, RoundingMode.HALF_UP).longValueExact();
    }
}
