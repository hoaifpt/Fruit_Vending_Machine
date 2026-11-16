package com.fruitmachine.backend.common.request;

import com.fruitmachine.backend.common.exception.BadRequestException;
import java.time.Instant;

/** Optional history range of a read API: {@code from} inclusive, {@code to} exclusive; a missing end is open. */
public record TimeRange(Instant from, Instant to) {
    /** Earlier and later than any stored row; used for an open end so queries always compare both bounds. */
    public static final Instant OPEN_FROM = Instant.parse("1970-01-01T00:00:00Z");
    public static final Instant OPEN_TO = Instant.parse("9999-01-01T00:00:00Z");

    public static TimeRange of(Instant from, Instant to) {
        if (from != null && to != null && !to.isAfter(from)) throw new BadRequestException("to must be after from");
        return new TimeRange(from == null ? OPEN_FROM : from, to == null ? OPEN_TO : to);
    }

    /** Page index and size of a history read; size at most {@code maxSize}. */
    public static void checkPage(int page, int size, int maxSize) {
        if (page < 0 || size < 1 || size > maxSize)
            throw new BadRequestException("Page must be nonnegative and size must be between 1 and " + maxSize);
    }
}
