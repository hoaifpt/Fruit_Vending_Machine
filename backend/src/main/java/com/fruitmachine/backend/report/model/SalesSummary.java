package com.fruitmachine.backend.report.model;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.Map;

@Schema(description = "Sales summary (issue #76). Amounts in whole VND. Sales = orders delivered (completed_at in range); refunds by refunded_at.")
public record SalesSummary(FiltersEcho filters,
        @Schema(description = "Orders with completed_at in range (COMPLETED, or REFUNDED after completion).") long ordersSold,
        @Schema(description = "Sum of subtotal of sold orders.") long grossSales,
        @Schema(description = "Sum of discount_amount of sold orders.") long discounts,
        @Schema(description = "Sum of total_amount of sold orders (gross - discounts).") long netSales,
        @Schema(description = "Refunds of delivered orders (PRODUCT_QUALITY / OTHER on completed orders) by refunded_at in range.") long deliveredRefunds,
        @Schema(description = "netSales - deliveredRefunds.") long netRevenue,
        @Schema(description = "netSales / ordersSold rounded down; 0 without sales.") long averageOrderValue,
        @Schema(description = "Payments SUCCESS or REFUNDED by paid_at in range (cash view).") long moneyCollected,
        MoneyRefunded moneyRefunded,
        @Schema(description = "Current refund candidates (point in time; ignores the range and filters).") PendingRefunds pendingRefunds,
        @Schema(description = "Orders paid in range that failed to dispense (DISPENSE_FAILED, refunded without delivery, or with a FAILED/TIMEOUT dispense command).") long failedDispenses,
        Instant generatedAt) {

    @Schema(description = "REFUNDED payments by refunded_at in range, by refund reason (every reason listed).")
    public record MoneyRefunded(long total, Map<String, Long> byReason) {
    }

    public record PendingRefunds(long count, long amount) {
    }
}
