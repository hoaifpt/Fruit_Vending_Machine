package com.fruitmachine.backend.payment.gateway.payos;

import java.math.BigDecimal;
import java.time.Instant;

/** Parsed payOS webhook, produced only after the signature was verified. */
public record PayOsWebhookEvent(boolean success, String paymentReference, String transactionId, BigDecimal amount,
        Instant transactionTime, String paymentLinkId) {
}
