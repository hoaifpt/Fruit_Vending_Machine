package com.fruitmachine.backend.report.model;

import java.time.Instant;
import java.util.List;

public record SalesSeries(FiltersEcho filters, Granularity granularity, List<SalesBucket> buckets, Instant generatedAt) {
    /** DAY; WEEK = ISO week (Monday start); MONTH = calendar month; all in the business zone. */
    public enum Granularity { DAY, WEEK, MONTH }
}
