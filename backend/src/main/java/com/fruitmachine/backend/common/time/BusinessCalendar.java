package com.fruitmachine.backend.common.time;

import com.fruitmachine.backend.config.properties.BusinessProperties;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Business days in the configured zone (issue #61, {@code app.business-zone}, default Asia/Ho_Chi_Minh), built on the injected
 * Clock. A day runs from {@link #dayStart} inclusive to {@link #dayEnd} exclusive (the next day's start), so DST-free and DST
 * zones alike never lose or double-count an instant.
 */
@Component
@EnableConfigurationProperties(BusinessProperties.class)
public class BusinessCalendar {
    private final Clock clock;
    private final ZoneId zone;

    public BusinessCalendar(Clock clock, BusinessProperties properties) {
        this.clock = clock;
        this.zone = properties.zone();
    }

    public ZoneId zone() {
        return zone;
    }

    public LocalDate today() {
        return today(clock.instant());
    }

    public LocalDate today(Instant at) {
        return LocalDate.ofInstant(at, zone);
    }

    public LocalDate dayOf(Instant at) {
        return LocalDate.ofInstant(at, zone);
    }

    public Instant dayStart(LocalDate day) {
        return day.atStartOfDay(zone).toInstant();
    }

    public Instant dayEnd(LocalDate day) {
        return day.plusDays(1).atStartOfDay(zone).toInstant();
    }
}
