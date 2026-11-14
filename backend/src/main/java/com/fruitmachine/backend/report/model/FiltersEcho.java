package com.fruitmachine.backend.report.model;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** The filters a report was built with, echoed in every response. */
public record FiltersEcho(LocalDate from, LocalDate to, List<UUID> machineIds, List<UUID> productIds, String zone) {
}
