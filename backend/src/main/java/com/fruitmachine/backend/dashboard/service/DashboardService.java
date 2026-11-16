package com.fruitmachine.backend.dashboard.service;

import com.fruitmachine.backend.alert.repository.HealthCheckQueries;
import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.config.properties.HealthCheckProperties;
import com.fruitmachine.backend.config.properties.OrderProperties;
import com.fruitmachine.backend.dashboard.dto.DashboardOverviewResponse;
import com.fruitmachine.backend.dashboard.dto.DashboardOverviewResponse.*;
import com.fruitmachine.backend.machine.enums.MachineConnectivity;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.machine.service.ConnectivityEvaluator;
import com.fruitmachine.backend.payment.refund.service.RefundQueryService;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The operations dashboard (issue #76) in a fixed number of statements (at most 7): machines with latest temperature, slot conditions
 * of all operating machines (the health-check predicates), alerts, work orders, and for REPORT_SALES_READ holders today's sales and the
 * pending refunds. STAFF sees every machine (operational data) but no money.
 */
@Service
@RequiredArgsConstructor
public class DashboardService {
    private final JdbcTemplate jdbc;
    private final HealthCheckQueries health;
    private final HealthCheckProperties healthProperties;
    private final OrderProperties orderProperties;
    private final ConnectivityEvaluator connectivity;
    private final RefundQueryService refunds;
    private final BusinessCalendar calendar;
    private final Clock clock;

    private record MachineRow(UUID id, String code, String name, MachineStatus status, Instant lastSeenAt, Instant lastOfflineAt, BigDecimal temperature) { }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_DASHBOARD_READ)
    public DashboardOverviewResponse overview() {
        Instant now = clock.instant();
        LocalDate today = calendar.today();
        UUID me = ((AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal()).getId();

        // 1. machines + latest temperature (index on sensor_readings(machine_id, recorded_at))
        List<MachineRow> machines = jdbc.query("""
                SELECT m.id, m.code, m.name, m.status, m.last_seen_at, m.last_offline_at,
                       (SELECT r.temperature FROM sensor_readings r WHERE r.machine_id = m.id AND r.temperature IS NOT NULL
                        ORDER BY r.recorded_at DESC LIMIT 1)
                FROM machines m ORDER BY m.code""",
                (rs, row) -> new MachineRow(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), MachineStatus.valueOf(rs.getString(4)),
                        instant(rs.getTimestamp(5)), instant(rs.getTimestamp(6)), rs.getBigDecimal(7)));

        // 2. slots of every operating machine (same SQL as the health check; expiring window ends with the business day)
        Map<UUID, Long> sellable = new HashMap<>();
        long low = 0, blocked = 0, expiring = 0;
        for (var slot : health.slotsOfOperatingMachines(now, now.plus(orderProperties.reservationTtl()), calendar.dayEnd(today))) {
            sellable.merge(slot.machineId(), slot.sellable(), Long::sum);
            if ("ACTIVE".equals(slot.slotStatus()) && slot.sellable() <= healthProperties.lowStockThreshold()) low++;
            if ("ERROR".equals(slot.slotStatus()) || "DISPENSE_FAILED".equals(slot.headStatus())) blocked++;
            expiring += slot.expiring();
        }

        // 3. alerts not resolved, per machine and severity
        Map<UUID, Long> alertsByMachine = new HashMap<>();
        long[] severity = new long[3];
        jdbc.query("SELECT machine_id, severity, count(*) FROM alerts WHERE status <> 'RESOLVED' GROUP BY machine_id, severity", rs -> {
            long n = rs.getLong(3);
            UUID machine = rs.getObject(1, UUID.class);
            if (machine != null) alertsByMachine.merge(machine, n, Long::sum);
            switch (rs.getString(2)) {
                case "CRITICAL" -> severity[0] += n;
                case "WARNING" -> severity[1] += n;
                default -> severity[2] += n;
            }
        });
        Alerts alerts = new Alerts(severity[0] + severity[1] + severity[2], severity[0], severity[1], severity[2]);

        // 4. work orders
        WorkOrders workOrders = jdbc.queryForObject("""
                SELECT count(*) FILTER (WHERE status IN ('OPEN', 'ASSIGNED')),
                       count(*) FILTER (WHERE status = 'IN_PROGRESS'),
                       count(*) FILTER (WHERE status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS') AND due_at < ?),
                       count(*) FILTER (WHERE status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS') AND assignee_id = ?)
                FROM work_orders""",
                (rs, row) -> new WorkOrders(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getLong(4)), Timestamp.from(now), me);

        Today todaySales = null;
        Refunds pending = null;
        if (has(Permissions.REPORT_SALES_READ)) {
            // 5. today and yesterday (sales definition of the reports: completed_at, total_amount)
            Instant yesterdayStart = calendar.dayStart(today.minusDays(1)), todayStart = calendar.dayStart(today), todayEnd = calendar.dayEnd(today);
            todaySales = jdbc.queryForObject("""
                    SELECT count(*) FILTER (WHERE completed_at >= ?), coalesce(sum(total_amount) FILTER (WHERE completed_at >= ?), 0),
                           coalesce(sum(total_amount) FILTER (WHERE completed_at < ?), 0)
                    FROM orders WHERE completed_at >= ? AND completed_at < ?""",
                    (rs, row) -> new Today(today, rs.getLong(1), money(rs.getBigDecimal(2)), money(rs.getBigDecimal(3))),
                    Timestamp.from(todayStart), Timestamp.from(todayStart), Timestamp.from(todayStart), Timestamp.from(yesterdayStart), Timestamp.from(todayEnd));
            // 6. pending refunds (the refund candidate rules)
            var totals = refunds.pendingTotals();
            pending = new Refunds(totals.count(), totals.amount());
        }

        long active = 0, maintenance = 0, inactive = 0, online = 0, warning = 0, offline = 0, neverSeen = 0;
        List<MachineDetail> details = new ArrayList<>();
        for (MachineRow m : machines) {
            switch (m.status()) {
                case ACTIVE -> active++;
                case MAINTENANCE -> maintenance++;
                case INACTIVE -> inactive++;
            }
            MachineConnectivity state = connectivity.evaluate(m.lastSeenAt(), m.lastOfflineAt(), now);
            switch (state) {
                case ONLINE -> online++;
                case WARNING -> warning++;
                case OFFLINE -> offline++;
                case NEVER_SEEN -> neverSeen++;
            }
            details.add(new MachineDetail(m.id(), m.code(), m.name(), m.status(), state, m.lastSeenAt(), m.temperature(),
                    sellable.getOrDefault(m.id(), 0L), alertsByMachine.getOrDefault(m.id(), 0L)));
        }
        return new DashboardOverviewResponse(now.truncatedTo(ChronoUnit.MILLIS), todaySales,
                new Machines(machines.size(), active, maintenance, inactive, online, warning, offline, neverSeen), alerts, workOrders,
                new Stock(low, blocked, expiring), pending, details);
    }

    private static boolean has(String authority) {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null && authentication.getAuthorities().stream().anyMatch(a -> authority.equals(a.getAuthority()));
    }

    private static long money(BigDecimal value) {
        return value == null ? 0 : value.setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    private static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
