package com.fruitmachine.backend.config.properties;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Issue #70: how often due maintenance plans are turned into work orders (also once shortly after startup). */
@ConfigurationProperties("app.maintenance-schedule")
public record MaintenanceScheduleProperties(@DefaultValue("true") boolean enabled, @DefaultValue("PT1H") Duration interval) {
    public MaintenanceScheduleProperties {
        if (interval == null || interval.isZero() || interval.isNegative())
            throw new IllegalArgumentException("app.maintenance-schedule.interval must be positive");
    }
}
