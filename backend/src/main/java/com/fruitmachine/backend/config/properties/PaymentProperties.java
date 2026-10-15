package com.fruitmachine.backend.config.properties;

import java.time.Duration;
import java.util.Locale;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Payment attempt settings; invalid values fail application startup. */
@ConfigurationProperties("app.payment")
public record PaymentProperties(
        @DefaultValue("MOCK") String provider,
        @DefaultValue("PT5M") Duration attemptTtl,
        @DefaultValue("PT30S") Duration minRemainingHold,
        @DefaultValue("5") int maxAttemptsPerOrder,
        @DefaultValue("PT10S") Duration providerTimeout) {
    public PaymentProperties {
        if (provider == null || provider.isBlank()) throw new IllegalArgumentException("app.payment.provider must not be blank");
        provider = provider.strip().toUpperCase(Locale.ROOT);
        if (attemptTtl == null || attemptTtl.isZero() || attemptTtl.isNegative())
            throw new IllegalArgumentException("app.payment.attempt-ttl must be positive");
        if (minRemainingHold == null || minRemainingHold.isNegative())
            throw new IllegalArgumentException("app.payment.min-remaining-hold must not be negative");
        if (maxAttemptsPerOrder < 1) throw new IllegalArgumentException("app.payment.max-attempts-per-order must be at least 1");
        if (providerTimeout == null || providerTimeout.isZero() || providerTimeout.isNegative())
            throw new IllegalArgumentException("app.payment.provider-timeout must be positive");
    }
}
