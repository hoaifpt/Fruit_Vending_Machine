package com.fruitmachine.backend.report.model;

import java.math.BigDecimal;
import java.util.UUID;

/** Sales of one product (order_items.product_id; one item per order). sharePercent = netSales / total netSales, 1 decimal. */
public record ProductSales(UUID productId, String sku, String name, String status, long quantity, long grossSales, long discounts, long netSales,
        long deliveredRefunds, BigDecimal sharePercent) {
}
