package com.fruitmachine.backend.payment.gateway;

import java.math.BigDecimal;
import java.time.Instant;

public record ProviderPaymentRequest(String paymentReference, String orderCode, BigDecimal amount, String description,
        Instant expiresAt) {
}
