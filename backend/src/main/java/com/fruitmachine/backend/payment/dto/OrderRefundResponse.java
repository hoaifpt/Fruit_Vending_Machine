package com.fruitmachine.backend.payment.dto;

import com.fruitmachine.backend.payment.enums.RefundReason;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "A refunded payment of the order (issue #72). Listed only for callers holding REFUND_READ.")
public record OrderRefundResponse(UUID paymentId, BigDecimal amount, Instant refundedAt, RefundActorResponse refundedBy, RefundReason reason,
        String transferReference, String note) {
}
