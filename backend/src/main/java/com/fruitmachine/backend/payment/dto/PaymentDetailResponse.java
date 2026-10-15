package com.fruitmachine.backend.payment.dto;

import com.fruitmachine.backend.payment.enums.PaymentStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** Management detail: the list fields plus the QR payload. */
public record PaymentDetailResponse(UUID id, UUID orderId, String orderCode, String machineCode, String provider, PaymentStatus status,
        BigDecimal amount, String paymentReference, String transactionId, Instant createdAt, Instant paidAt, Instant expiredAt,
        String qrCode) {
}
