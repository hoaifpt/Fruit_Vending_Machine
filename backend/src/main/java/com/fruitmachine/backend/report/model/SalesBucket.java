package com.fruitmachine.backend.report.model;

import java.time.LocalDate;

/** One period of a time series: start / end are business-zone dates clipped to the requested range. */
public record SalesBucket(LocalDate start, LocalDate end, long ordersSold, long grossSales, long discounts, long netSales, long deliveredRefunds,
        long netRevenue) {
}
