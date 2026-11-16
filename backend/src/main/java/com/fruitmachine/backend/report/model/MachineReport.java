package com.fruitmachine.backend.report.model;

import java.time.Instant;
import java.util.List;

public record MachineReport(FiltersEcho filters, List<MachineSales> machines, Instant generatedAt) {
}
