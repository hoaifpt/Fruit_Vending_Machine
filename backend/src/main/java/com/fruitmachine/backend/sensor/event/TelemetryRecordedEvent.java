package com.fruitmachine.backend.sensor.event;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** A telemetry reading was stored (either value may be null). Consume it after commit; display only, no alert in #53. */
public record TelemetryRecordedEvent(UUID machineId, BigDecimal temperature, BigDecimal humidity, Instant recordedAt) {
}
