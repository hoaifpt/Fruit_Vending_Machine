package com.fruitmachine.backend.report.model;

import java.time.Instant;
import java.util.List;

public record ProductReport(FiltersEcho filters, SortBy sortBy, int limit, List<ProductSales> products, Instant generatedAt) {
    public enum SortBy { QUANTITY, NET_SALES }
}
