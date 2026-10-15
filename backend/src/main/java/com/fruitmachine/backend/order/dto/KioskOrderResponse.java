package com.fruitmachine.backend.order.dto;

import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.payment.dto.KioskPaymentResponse;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Schema(description = "Order as seen by the owning kiosk. A PENDING_PAYMENT order past expiresAt may be returned until the sweep runs; use expiresAt for the countdown.")
public record KioskOrderResponse(UUID id, String orderCode, UUID machineId, OrderStatus status,
        List<KioskOrderItemResponse> items, BigDecimal subtotal, BigDecimal totalAmount, Instant createdAt,
        Instant expiresAt, Instant cancelledAt,
        @Schema(description = "Most recent payment attempt, or null before the first attempt. Poll this endpoint every 2-3 seconds; after the webhook issue it also shows PAID.", nullable = true) KioskPaymentResponse currentPayment) {
}
