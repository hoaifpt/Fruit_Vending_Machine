package com.fruitmachine.backend.mqtt.inbound;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Logs at most one WARN per (machine or topic, reason) per window and reports how many identical warnings were suppressed,
 * so a misbehaving device cannot flood the log. Keys come from untrusted topics, so the map is bounded.
 */
@Component
public class RejectionLogLimiter {
    private static final Logger log = LoggerFactory.getLogger(MqttInboundAdapter.class);
    static final Duration WINDOW = Duration.ofMinutes(1);
    static final int MAX_KEYS = 1024;
    private static final int MAX_TOPIC_LOG_LENGTH = 128;

    private record Window(Instant start, AtomicLong suppressed) {}

    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();
    private final Clock clock;

    public RejectionLogLimiter(Clock clock) {
        this.clock = clock;
    }

    /** @return true when the warning was written (false when it was suppressed). */
    public boolean warn(String topic, MachineMessageRejectedException rejection) {
        String source = rejection.machineCode() != null ? rejection.machineCode() : "topic:" + sanitize(topic);
        String key = source + "|" + rejection.reason();
        Instant now = clock.instant();
        if (windows.size() >= MAX_KEYS && !windows.containsKey(key)) windows.clear();
        long[] suppressed = {0};
        boolean[] write = {false};
        windows.compute(key, (k, current) -> {
            if (current == null || !now.isBefore(current.start().plus(WINDOW))) {
                suppressed[0] = current == null ? 0 : current.suppressed().get();
                write[0] = true;
                return new Window(now, new AtomicLong());
            }
            current.suppressed().incrementAndGet();
            return current;
        });
        if (!write[0]) return false;
        log.warn("Dropped MQTT message: reason={}, topic={}, machineCode={}, messageId={}, detail={}{}", rejection.reason(), sanitize(topic),
                rejection.machineCode(), rejection.messageId(), rejection.getMessage(),
                suppressed[0] > 0 ? " (" + suppressed[0] + " identical warnings suppressed in the last window)" : "");
        return true;
    }

    /** Printable ASCII only, truncated: topics are attacker-controlled up to the broker ACL. */
    static String sanitize(String topic) {
        if (topic == null) return "<none>";
        StringBuilder out = new StringBuilder(Math.min(topic.length(), MAX_TOPIC_LOG_LENGTH));
        for (int i = 0; i < topic.length() && out.length() < MAX_TOPIC_LOG_LENGTH; i++) {
            char c = topic.charAt(i);
            out.append(c >= 0x20 && c < 0x7F ? c : '?');
        }
        return topic.length() > MAX_TOPIC_LOG_LENGTH ? out + "..." : out.toString();
    }
}
