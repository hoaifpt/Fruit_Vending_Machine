package com.fruitmachine.backend.payment.refund.dto;

import com.fruitmachine.backend.payment.dto.RefundActorResponse;
import com.fruitmachine.backend.payment.enums.RefundReason;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** A recorded refund: a REFUNDED payment with its refund fields. */
public record RefundResponse(UUID paymentId, BigDecimal amount, Instant paidAt, Instant refundedAt, RefundActorResponse refundedBy,
        RefundReason reason, String transferReference, String note, RefundOrderResponse order) {
}
