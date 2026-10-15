package com.fruitmachine.backend.payment.dto;

import com.fruitmachine.backend.payment.enums.PaymentStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** Management list item. Deliberately has no qrCode. */
public record PaymentResponse(UUID id, UUID orderId, String orderCode, String machineCode, String provider, PaymentStatus status,
        BigDecimal amount, String paymentReference, String transactionId, Instant createdAt, Instant paidAt, Instant expiredAt) {
}
