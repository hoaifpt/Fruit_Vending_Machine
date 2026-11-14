package com.fruitmachine.backend.report.model;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;

public record PeakHours(FiltersEcho filters,
        @Schema(description = "24 entries, hour 0..23 of completed_at in the business zone.") List<PeakHour> hours,
        @Schema(description = "7 x 24 ordersSold: index 0 = Monday ... 6 = Sunday, then hour 0..23.") List<List<Long>> weekdayHours,
        Instant generatedAt) {

    public record PeakHour(int hour, long ordersSold, long netSales) {
    }
}
