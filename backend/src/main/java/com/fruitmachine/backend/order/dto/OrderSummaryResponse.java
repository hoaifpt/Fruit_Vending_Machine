package com.fruitmachine.backend.order.dto;

import com.fruitmachine.backend.order.enums.OrderStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record OrderSummaryResponse(UUID id, String orderCode, UUID machineId, String machineCode, OrderStatus status,
        @Schema(description = "Number of order lines (distinct products), not the bowl quantity.") long itemCount,
        @Schema(description = "Total number of bowls ordered (sum of line quantities).") long totalQuantity,
        BigDecimal totalAmount, Instant createdAt, Instant expiresAt, Instant cancelledAt) {
}
