package com.fruitmachine.backend.payment.dto;

import com.fruitmachine.backend.payment.enums.PaymentStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "Payment summary inside order details. No qrCode, paymentReference or transactionId; ADMIN uses the payments API for those.")
public record PaymentSummaryResponse(UUID id, String provider, PaymentStatus status, BigDecimal amount, Instant createdAt,
        Instant paidAt, Instant expiredAt) {
}
