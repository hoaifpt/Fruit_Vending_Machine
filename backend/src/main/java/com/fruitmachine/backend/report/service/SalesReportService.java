package com.fruitmachine.backend.report.service;

import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.payment.enums.RefundReason;
import com.fruitmachine.backend.payment.refund.service.RefundQueryService;
import com.fruitmachine.backend.report.model.*;
import com.fruitmachine.backend.report.repository.SalesReportQueries;
import com.fruitmachine.backend.security.permission.Permissions;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Sales reports (issue #76). Definitions live in docs/reports.md and SalesReportQueries; this service validates filters, fills empty
 * buckets with zeros and assembles the responses. All days and hours are business-zone (Asia/Ho_Chi_Minh by default).
 */
@Service
@RequiredArgsConstructor
public class SalesReportService {
    public static final int MAX_DAYS = 366;
    public static final int MAX_IDS = 20;

    private final SalesReportQueries queries;
    private final RefundQueryService refunds;
    private final BusinessCalendar calendar;
    private final Clock clock;

    /** Validates and converts the common parameters once: [startOfDay(from), startOfDay(to + 1)). */
    public ReportFilters filters(LocalDate from, LocalDate to, List<UUID> machineIds, List<UUID> productIds) {
        if (from == null || to == null) throw new BadRequestException("from and to are required");
        if (to.isBefore(from)) throw new BadRequestException("to must not be before from");
        if (ChronoUnit.DAYS.between(from, to) + 1 > MAX_DAYS) throw new BadRequestException("the range must be at most " + MAX_DAYS + " days");
        List<UUID> machines = distinct(machineIds, "machineId");
        List<UUID> products = distinct(productIds, "productId");
        unknown(machines, queries.existingMachines(machines), "machineId");
        unknown(products, queries.existingProducts(products), "productId");
        return new ReportFilters(from, to, machines, products, calendar.zone().getId(), calendar.dayStart(from), calendar.dayEnd(to));
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_REPORT_SALES_READ)
    public SalesSummary summary(ReportFilters filters) {
        return buildSummary(filters);
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_REPORT_SALES_READ)
    public SalesSeries series(ReportFilters filters, SalesSeries.Granularity granularity) {
        return new SalesSeries(filters.echo(), granularity, buckets(filters, granularity), now());
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_REPORT_SALES_READ)
    public PeakHours peakHours(ReportFilters filters) {
        return buildPeakHours(filters);
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_REPORT_SALES_READ)
    public ProductReport products(ReportFilters filters, ProductReport.SortBy sortBy, int limit) {
        if (limit < 1 || limit > 100) throw new BadRequestException("limit must be 1..100");
        return new ProductReport(filters.echo(), sortBy, limit, buildProducts(filters, sortBy, limit, queries.netSales(filters)), now());
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_REPORT_SALES_READ)
    public MachineReport machines(ReportFilters filters) {
        return new MachineReport(filters.echo(), buildMachines(filters), now());
    }

    /** The whole report for export: summary, DAY series, peak hours, every product, machines. */
    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_REPORT_EXPORT)
    public SalesReport report(ReportFilters filters, String generatedBy) {
        SalesSummary summary = buildSummary(filters);
        return new SalesReport(summary, buckets(filters, SalesSeries.Granularity.DAY), buildPeakHours(filters),
                buildProducts(filters, ProductReport.SortBy.NET_SALES, null, summary.netSales()), buildMachines(filters), summary.generatedAt(), generatedBy);
    }

    private SalesSummary buildSummary(ReportFilters filters) {
        SalesReportQueries.Totals t = queries.totals(filters);
        Map<String, Long> byReason = new LinkedHashMap<>();
        for (RefundReason reason : RefundReason.values()) byReason.put(reason.name(), 0L);
        long refunded = 0;
        for (var entry : queries.refundsByReason(filters).entrySet()) {
            byReason.put(entry.getKey(), entry.getValue());
            refunded += entry.getValue();
        }
        var pending = refunds.pendingTotals();
        long average = t.ordersSold() == 0 ? 0 : Math.floorDiv(t.netSales(), t.ordersSold());
        return new SalesSummary(filters.echo(), t.ordersSold(), t.grossSales(), t.discounts(), t.netSales(), t.deliveredRefunds(),
                t.netSales() - t.deliveredRefunds(), average, t.moneyCollected(), new SalesSummary.MoneyRefunded(refunded, byReason),
                new SalesSummary.PendingRefunds(pending.count(), pending.amount()), t.failedDispenses(), now());
    }

    /** Continuous series: every bucket between from and to, zeros where nothing happened; start/end clipped to the range. */
    private List<SalesBucket> buckets(ReportFilters filters, SalesSeries.Granularity granularity) {
        String unit = switch (granularity) { case DAY -> "day"; case WEEK -> "week"; case MONTH -> "month"; };
        Map<LocalDate, SalesReportQueries.BucketRow> sales = new LinkedHashMap<>();
        for (var row : queries.salesBuckets(filters, unit)) sales.put(row.bucket(), row);
        Map<LocalDate, Long> refunded = queries.refundBuckets(filters, unit);
        List<SalesBucket> buckets = new ArrayList<>();
        for (LocalDate start = bucketStart(filters.from(), granularity); !start.isAfter(filters.to()); start = next(start, granularity)) {
            var row = sales.get(start);
            long refund = refunded.getOrDefault(start, 0L);
            LocalDate end = next(start, granularity).minusDays(1);
            long net = row == null ? 0 : row.netSales();
            buckets.add(new SalesBucket(start.isBefore(filters.from()) ? filters.from() : start, end.isAfter(filters.to()) ? filters.to() : end,
                    row == null ? 0 : row.ordersSold(), row == null ? 0 : row.grossSales(), row == null ? 0 : row.discounts(), net, refund, net - refund));
        }
        return buckets;
    }

    private PeakHours buildPeakHours(ReportFilters filters) {
        long[] orders = new long[24], net = new long[24];
        long[][] matrix = new long[7][24];
        for (var row : queries.hours(filters)) {
            orders[row.hour()] += row.ordersSold();
            net[row.hour()] += row.netSales();
            matrix[row.isoWeekday() - 1][row.hour()] = row.ordersSold();
        }
        List<PeakHours.PeakHour> hours = new ArrayList<>();
        for (int h = 0; h < 24; h++) hours.add(new PeakHours.PeakHour(h, orders[h], net[h]));
        List<List<Long>> weekdays = new ArrayList<>();
        for (long[] day : matrix) weekdays.add(java.util.Arrays.stream(day).boxed().toList());
        return new PeakHours(filters.echo(), hours, weekdays, now());
    }

    private List<ProductSales> buildProducts(ReportFilters filters, ProductReport.SortBy sortBy, Integer limit, long totalNet) {
        return queries.products(filters, sortBy == ProductReport.SortBy.QUANTITY, limit).stream()
                .map(r -> new ProductSales(r.productId(), r.sku(), r.name(), r.status(), r.quantity(), r.grossSales(), r.discounts(), r.netSales(),
                        r.deliveredRefunds(), share(r.netSales(), totalNet)))
                .toList();
    }

    private List<MachineSales> buildMachines(ReportFilters filters) {
        return queries.machines(filters).stream().map(r -> new MachineSales(r.machineId(), r.code(), r.name(), r.ordersSold(), r.netSales(),
                r.deliveredRefunds(), r.netSales() - r.deliveredRefunds())).toList();
    }

    static BigDecimal share(long part, long total) {
        if (total == 0) return BigDecimal.ZERO.setScale(1);
        return BigDecimal.valueOf(part).multiply(BigDecimal.valueOf(100)).divide(BigDecimal.valueOf(total), 1, RoundingMode.HALF_UP);
    }

    private static LocalDate bucketStart(LocalDate day, SalesSeries.Granularity granularity) {
        return switch (granularity) {
            case DAY -> day;
            case WEEK -> day.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            case MONTH -> day.withDayOfMonth(1);
        };
    }

    private static LocalDate next(LocalDate start, SalesSeries.Granularity granularity) {
        return switch (granularity) {
            case DAY -> start.plusDays(1);
            case WEEK -> start.plusWeeks(1);
            case MONTH -> start.plusMonths(1);
        };
    }

    private static List<UUID> distinct(List<UUID> ids, String name) {
        List<UUID> result = ids == null ? List.of() : ids.stream().distinct().toList();
        if (result.size() > MAX_IDS) throw new BadRequestException("at most " + MAX_IDS + " " + name + " values");
        return result;
    }

    private static void unknown(List<UUID> requested, List<UUID> existing, String name) {
        for (UUID id : requested) {
            if (!existing.contains(id)) throw new BadRequestException("Unknown " + name + ": " + id, Map.of(name, id.toString()));
        }
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MILLIS);
    }
}
