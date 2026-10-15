package com.fruitmachine.backend.order.dto;

import com.fruitmachine.backend.order.enums.OrderStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record OrderDetailResponse(UUID id, String orderCode, UUID machineId, String machineCode, OrderStatus status,
        BigDecimal subtotal, BigDecimal totalAmount, Instant createdAt, Instant expiresAt, Instant paidAt,
        Instant completedAt, Instant cancelledAt, List<OrderItemDetailResponse> items) {
}
