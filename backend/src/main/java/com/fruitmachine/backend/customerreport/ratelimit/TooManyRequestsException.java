package com.fruitmachine.backend.customerreport.ratelimit;

import java.time.Duration;

/** 429 with a Retry-After header (whole seconds). */
public class TooManyRequestsException extends RuntimeException {
    private final long retryAfterSeconds;

    public TooManyRequestsException(Duration retryAfter) {
        super("Too many requests; try again later");
        this.retryAfterSeconds = Math.max(1, (retryAfter.toMillis() + 999) / 1000);
    }

    public long retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
