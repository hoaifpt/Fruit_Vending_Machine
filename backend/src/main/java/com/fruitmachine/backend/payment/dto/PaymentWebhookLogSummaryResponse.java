package com.fruitmachine.backend.payment.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "One webhook attempt. The signature is never returned.")
public record PaymentWebhookLogSummaryResponse(UUID id, String provider,
        @Schema(description = "Event type reported by the verifier, for example PAYMENT_SUCCESS, PAYMENT_FAILED or UNKNOWN.", nullable = true) String eventType,
        @Schema(description = "Untrusted provider reference hint (for payOS the orderCode), not orders.order_code.", nullable = true) String reference,
        boolean verified, Instant receivedAt) {
}
