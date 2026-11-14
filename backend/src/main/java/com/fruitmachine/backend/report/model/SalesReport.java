package com.fruitmachine.backend.report.model;

import java.time.Instant;
import java.util.List;

/** The whole report, built once and rendered as CSV or PDF (identical numbers). */
public record SalesReport(SalesSummary summary, List<SalesBucket> daily, PeakHours peakHours, List<ProductSales> products, List<MachineSales> machines,
        Instant generatedAt, String generatedBy) {
}
