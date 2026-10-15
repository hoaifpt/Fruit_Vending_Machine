package com.fruitmachine.backend.payment.dto;

import com.fruitmachine.backend.payment.enums.PaymentStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "Payment attempt as seen by the owning kiosk. The amount always equals the order total; success is never reported here.")
public record KioskPaymentResponse(
        UUID paymentId,
        UUID orderId,
        @Schema(description = "Active provider code, for example MOCK.", example = "MOCK") String provider,
        PaymentStatus status,
        BigDecimal amount,
        @Schema(description = "QR payload to display. Present only while the attempt is PENDING, null otherwise.", nullable = true) String qrCode,
        @Schema(description = "Attempt deadline, never later than the order reservation deadline.") Instant expiresAt) {
}
