package com.fruitmachine.backend.payment.gateway;

import java.time.Instant;

/** providerExpiresAt is nullable: the provider may not impose its own deadline. */
public record ProviderPaymentResult(String qrCode, Instant providerExpiresAt) {
}
