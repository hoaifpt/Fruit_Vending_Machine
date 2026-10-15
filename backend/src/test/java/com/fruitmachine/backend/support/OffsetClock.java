package com.fruitmachine.backend.support;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

/**
 * Real time plus a forward-only offset. Moving only forward keeps database-generated created_at values
 * (taken from the PostgreSQL server clock) consistent with CHECK constraints such as released_at >= created_at.
 */
public final class OffsetClock extends Clock {
    private volatile Duration offset = Duration.ZERO;

    public void advance(Duration amount) {
        if (amount.isNegative()) throw new IllegalArgumentException("Test clock only moves forward");
        offset = offset.plus(amount);
    }

    public void reset() {
        offset = Duration.ZERO;
    }

    @Override
    public ZoneId getZone() {
        return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
        return this;
    }

    @Override
    public Instant instant() {
        return Instant.now().plus(offset);
    }
}
