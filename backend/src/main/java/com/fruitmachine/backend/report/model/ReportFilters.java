package com.fruitmachine.backend.report.model;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Validated report filters: business-zone dates [from, to] converted once to [start, end) instants; optional machine and product ids
 * (empty = all).
 */
public record ReportFilters(LocalDate from, LocalDate to, List<UUID> machineIds, List<UUID> productIds, String zone, Instant start, Instant end) {
    public FiltersEcho echo() {
        return new FiltersEcho(from, to, machineIds, productIds, zone);
    }
}
