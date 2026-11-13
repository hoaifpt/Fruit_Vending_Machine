package com.fruitmachine.backend.config.properties;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Maintenance command delivery (issue #64). Unfinished commands are re-sent every {@code resendInterval} with the same code;
 * no ACCEPTED within {@code acceptTimeout} of creation fails the command; no COMPLETED within {@code completeTimeout} of ACCEPTED
 * leaves it to Staff (NEEDS_RECONCILIATION). The dispatcher ticks every {@code dispatcher.interval}.
 */
@ConfigurationProperties("app.maintenance-command")
public record MaintenanceCommandProperties(
        @DefaultValue("PT5S") Duration resendInterval,
        @DefaultValue("PT30S") Duration acceptTimeout,
        @DefaultValue("PT90S") Duration completeTimeout,
        @DefaultValue Dispatcher dispatcher) {
    public MaintenanceCommandProperties {
        positive(resendInterval, "app.maintenance-command.resend-interval");
        positive(acceptTimeout, "app.maintenance-command.accept-timeout");
        positive(completeTimeout, "app.maintenance-command.complete-timeout");
    }

    public record Dispatcher(@DefaultValue("true") boolean enabled, @DefaultValue("PT1S") Duration interval) {
        public Dispatcher {
            positive(interval, "app.maintenance-command.dispatcher.interval");
        }
    }

    private static void positive(Duration value, String name) {
        if (value == null || value.isZero() || value.isNegative()) throw new IllegalArgumentException(name + " must be positive");
    }
}
