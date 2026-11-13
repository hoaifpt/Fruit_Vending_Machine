package com.fruitmachine.backend.order.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.payment.dto.OrderRefundResponse;
import com.fruitmachine.backend.payment.dto.PaymentSummaryResponse;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record OrderDetailResponse(UUID id, String orderCode, UUID machineId, String machineCode, OrderStatus status,
        @Schema(description = "Sum of original prices.") BigDecimal subtotal,
        @Schema(description = "subtotal - totalAmount; 0 without a discount.") BigDecimal discountAmount,
        @Schema(description = "Amount charged (payment amount).") BigDecimal totalAmount, Instant createdAt, Instant expiresAt, Instant paidAt,
        Instant completedAt, Instant cancelledAt,
        @Schema(description = "Set when the order itself was refunded (status REFUNDED, issue #72).") Instant refundedAt,
        List<OrderItemDetailResponse> items, List<PaymentSummaryResponse> payments,
        @Schema(description = "Refunded payments of the order with transfer reference; empty unless the caller holds REFUND_READ.") List<OrderRefundResponse> refunds) {
}
