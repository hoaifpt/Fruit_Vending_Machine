package com.fruitmachine.backend.payment.refund.event;

import com.fruitmachine.backend.payment.enums.RefundReason;
import java.util.UUID;

/**
 * Published by RefundService inside the refund transaction, after the payment is REFUNDED (issue #74: open customer reports of the
 * order are closed by a synchronous listener in the same transaction). Carries no transfer reference.
 */
public record PaymentRefundedEvent(UUID paymentId, UUID orderId, UUID actorId, RefundReason reason) {
}
