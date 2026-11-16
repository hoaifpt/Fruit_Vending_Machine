package com.fruitmachine.backend.config.properties;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Telemetry intake protection, kept in memory of one backend instance: a reading closer than {@code minInterval} to the
 * previous stored reading of the machine is dropped, and so is a repeated messageId within {@code duplicateWindow}.
 */
@ConfigurationProperties("app.telemetry")
public record TelemetryProperties(
        @DefaultValue("PT10S") Duration minInterval,
        @DefaultValue("PT10M") Duration duplicateWindow) {
    public TelemetryProperties {
        if (minInterval == null || minInterval.isNegative()) throw new IllegalArgumentException("app.telemetry.min-interval must not be negative");
        if (duplicateWindow == null || duplicateWindow.isZero() || duplicateWindow.isNegative())
            throw new IllegalArgumentException("app.telemetry.duplicate-window must be positive");
    }
}
