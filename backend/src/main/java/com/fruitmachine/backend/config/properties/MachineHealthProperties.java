package com.fruitmachine.backend.config.properties;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Connectivity thresholds measured from {@code machines.last_seen_at} (api-contract/mqtt-contract.md §7). The firmware sends a
 * heartbeat every 30 s, so 60 s is two missed heartbeats; 180 s is the agreed offline threshold.
 */
@ConfigurationProperties("app.machine-health")
public record MachineHealthProperties(
        @DefaultValue("PT60S") Duration warningAfter,
        @DefaultValue("PT180S") Duration offlineAfter) {
    public MachineHealthProperties {
        if (warningAfter == null || offlineAfter == null || warningAfter.isZero() || warningAfter.isNegative()
                || offlineAfter.compareTo(warningAfter) <= 0) {
            throw new IllegalArgumentException("app.machine-health requires 0 < warning-after < offline-after");
        }
    }
}
