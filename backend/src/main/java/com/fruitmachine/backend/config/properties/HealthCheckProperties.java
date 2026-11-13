package com.fruitmachine.backend.config.properties;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Periodic machine health check (issue #58): every {@code interval} each ACTIVE or MAINTENANCE machine is evaluated.
 * LOW_STOCK at {@code lowStockThreshold} sellable bowls or fewer, PRODUCT_EXPIRING when a bowl expires within {@code expiringWithin}
 * (BM04 F-07), temperature/humidity alerts after a breach lasting {@code environmentGrace} (BR-18, value pending FX-10).
 */
@ConfigurationProperties("app.health-check")
public record HealthCheckProperties(
        @DefaultValue("true") boolean enabled,
        @DefaultValue("PT60S") Duration interval,
        @DefaultValue("2") int lowStockThreshold,
        @DefaultValue("PT12H") Duration expiringWithin,
        @DefaultValue("PT5M") Duration environmentGrace) {
    public HealthCheckProperties {
        positive(interval, "app.health-check.interval");
        positive(expiringWithin, "app.health-check.expiring-within");
        if (environmentGrace == null || environmentGrace.isNegative()) throw new IllegalArgumentException("app.health-check.environment-grace must not be negative");
        if (lowStockThreshold < 0) throw new IllegalArgumentException("app.health-check.low-stock-threshold must not be negative");
    }

    private static void positive(Duration value, String name) {
        if (value == null || value.isZero() || value.isNegative()) throw new IllegalArgumentException(name + " must be positive");
    }
}
