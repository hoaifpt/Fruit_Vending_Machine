package com.fruitmachine.backend.dashboard.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fruitmachine.backend.machine.enums.MachineConnectivity;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Home screen in one call (issue #76). today and refunds are money: present only for REPORT_SALES_READ holders (absent for STAFF). */
public record DashboardOverviewResponse(
        Instant generatedAt,
        @JsonInclude(JsonInclude.Include.NON_NULL) @Schema(description = "Only with REPORT_SALES_READ; absent otherwise (not zero).") Today today,
        Machines machines, Alerts alerts, WorkOrders workOrders, Stock stock,
        @JsonInclude(JsonInclude.Include.NON_NULL) @Schema(description = "Only with REPORT_SALES_READ; absent otherwise (not zero).") Refunds refunds,
        List<MachineDetail> machinesDetail) {

    @Schema(description = "Sales of the current business day (completed_at) and of yesterday, as in the sales report definitions.")
    public record Today(LocalDate date, long ordersSold, long netSales, long yesterdayNetSales) { }

    @Schema(description = "Machine statuses and connectivity (ONLINE, WARNING, OFFLINE, NEVER_SEEN, same rules as the machine API).")
    public record Machines(long total, long active, long maintenance, long inactive, long online, long warning, long offline, long neverSeen) { }

    @Schema(description = "Alerts not RESOLVED, by severity.")
    public record Alerts(long open, long critical, long warning, long info) { }

    @Schema(description = "open = OPEN or ASSIGNED, inProgress = IN_PROGRESS, overdue = unfinished past due, assignedToMe = unfinished assigned to the caller.")
    public record WorkOrders(long open, long inProgress, long overdue, long assignedToMe) { }

    @Schema(description = "Machines not INACTIVE, health-check predicates: lowStockSlots = ACTIVE slots with sellable bowls <= the low-stock threshold; "
            + "blockedSlots = slots in ERROR or whose head bowl is DISPENSE_FAILED; bowlsExpiringToday = physical unexpired bowls that expire before the end of today.")
    public record Stock(long lowStockSlots, long blockedSlots, long bowlsExpiringToday) { }

    @Schema(description = "Current refund candidates (count and amount).")
    public record Refunds(long pendingCount, long pendingAmount) { }

    public record MachineDetail(UUID machineId, String code, String name, MachineStatus status, MachineConnectivity connectivity, Instant lastSeenAt,
            @Schema(description = "Latest temperature reading; null without one.") BigDecimal temperature,
            @Schema(description = "Bowls the kiosk can sell now (catalog rule).") long sellableBowls,
            @Schema(description = "Alerts of the machine not RESOLVED.") long openAlerts) { }
}
