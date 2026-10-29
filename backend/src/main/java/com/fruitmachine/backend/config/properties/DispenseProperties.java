package com.fruitmachine.backend.config.properties;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Dispense command delivery. Unfinished commands are re-sent with the same command code (the firmware answers a repeated code
 * without moving), and give up after {@code timeout}.
 */
@ConfigurationProperties("app.dispense")
public record DispenseProperties(
        @DefaultValue("PT5S") Duration resendAfter,
        @DefaultValue("PT60S") Duration timeout,
        @DefaultValue Sweep sweep) {
    public DispenseProperties {
        positive(resendAfter, "app.dispense.resend-after");
        positive(timeout, "app.dispense.timeout");
    }

    public record Sweep(@DefaultValue("true") boolean enabled, @DefaultValue("PT2S") Duration interval) {
        public Sweep {
            positive(interval, "app.dispense.sweep.interval");
        }
    }

    private static void positive(Duration value, String name) {
        if (value == null || value.isZero() || value.isNegative()) throw new IllegalArgumentException(name + " must be positive");
    }
}
