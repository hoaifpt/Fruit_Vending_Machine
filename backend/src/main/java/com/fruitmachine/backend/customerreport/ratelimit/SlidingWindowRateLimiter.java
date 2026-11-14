package com.fruitmachine.backend.customerreport.ratelimit;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * In-memory sliding window: at most {@code limit} hits per key within {@code window}. One backend instance only (a shared store is
 * out of scope). Every call counts, so invalid floods are limited too. Idle keys are dropped by a periodic sweep.
 */
@Component
public class SlidingWindowRateLimiter {
    private static final Duration LONGEST_WINDOW = Duration.ofHours(1);
    private static final Duration SWEEP_EVERY = Duration.ofMinutes(10);
    private final Clock clock;
    private final Map<String, Deque<Instant>> hits = new ConcurrentHashMap<>();
    private volatile Instant lastSweep = Instant.EPOCH;

    public SlidingWindowRateLimiter(Clock clock) {
        this.clock = clock;
    }

    /** Records a hit; empty when allowed, otherwise how long until the oldest hit leaves the window (at least one second). */
    public Optional<Duration> tryAcquire(String key, int limit, Duration window) {
        Instant now = clock.instant();
        sweep(now);
        Deque<Instant> deque = hits.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (deque) {
            while (!deque.isEmpty() && !deque.peekFirst().isAfter(now.minus(window))) deque.pollFirst();
            if (deque.size() >= limit) {
                Duration wait = Duration.between(now, deque.peekFirst().plus(window));
                return Optional.of(wait.compareTo(Duration.ofSeconds(1)) < 0 ? Duration.ofSeconds(1) : wait);
            }
            deque.addLast(now);
            return Optional.empty();
        }
    }

    /** Tests only. */
    public void reset() {
        hits.clear();
    }

    private void sweep(Instant now) {
        if (Duration.between(lastSweep, now).compareTo(SWEEP_EVERY) < 0) return;
        lastSweep = now;
        hits.entrySet().removeIf(entry -> {
            synchronized (entry.getValue()) {
                return entry.getValue().isEmpty() || !entry.getValue().peekLast().isAfter(now.minus(LONGEST_WINDOW));
            }
        });
    }
}
