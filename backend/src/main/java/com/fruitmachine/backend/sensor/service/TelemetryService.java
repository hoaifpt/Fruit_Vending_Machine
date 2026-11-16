package com.fruitmachine.backend.sensor.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.config.properties.TelemetryProperties;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.machine.service.MachinePresenceService;
import com.fruitmachine.backend.mqtt.MachineEnvelope;
import com.fruitmachine.backend.sensor.entity.SensorReading;
import com.fruitmachine.backend.sensor.event.TelemetryRecordedEvent;
import com.fruitmachine.backend.sensor.repository.SensorReadingRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Telemetry intake (api-contract/mqtt-contract.md §5.3): validates the reading, drops repeats and readings that come too fast,
 * stores the rest in sensor_readings with the backend receive time. Display data only: no alert or status change here (3.6).
 * Duplicate and throttle state lives in memory of this single backend instance. Readings queued while the backend was down are
 * stored with their delivery time.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@EnableConfigurationProperties(TelemetryProperties.class)
public class TelemetryService {
    public static final BigDecimal MIN_TEMPERATURE = new BigDecimal("-40.00");
    public static final BigDecimal MAX_TEMPERATURE = new BigDecimal("85.00");
    public static final BigDecimal MIN_HUMIDITY = new BigDecimal("0.00");
    public static final BigDecimal MAX_HUMIDITY = new BigDecimal("100.00");
    private static final int PRUNE_ABOVE = 1_000;

    private final SensorReadingRepository readings;
    private final MachineRepository machines;
    private final MachinePresenceService presence;
    private final ApplicationEventPublisher events;
    private final TelemetryProperties properties;
    /** "machineId messageId" -> first seen; entries older than the duplicate window are pruned. */
    private final Map<String, Instant> seenMessages = new ConcurrentHashMap<>();
    /** machineId -> receive time of the last stored reading. */
    private final Map<UUID, Instant> lastStored = new ConcurrentHashMap<>();

    /** @throws MachineEnvelope.Invalid when the payload breaks the telemetry rules (nothing is written) */
    @Transactional
    public void record(UUID machineId, String machineCode, String messageId, JsonNode payload, Instant now) throws MachineEnvelope.Invalid {
        BigDecimal temperature = value(payload.path("temperature"), MIN_TEMPERATURE, MAX_TEMPERATURE, "temperature");
        BigDecimal humidity = value(payload.path("humidity"), MIN_HUMIDITY, MAX_HUMIDITY, "humidity");
        if (temperature == null && humidity == null) throw new MachineEnvelope.Invalid("telemetry needs temperature or humidity");
        // A valid message proves the machine is alive, even when the reading itself is not stored.
        presence.touch(machineId, machineCode, now);
        if (seenBefore(machineId, messageId, now)) {
            log.debug("Telemetry {} of machine {} is a repeat; dropped", messageId, machineCode);
            return;
        }
        if (!takeSlot(machineId, now)) {
            log.debug("Telemetry {} of machine {} came within {} of the previous reading; dropped", messageId, machineCode, properties.minInterval());
            return;
        }
        var reading = new SensorReading();
        reading.setMachine(machines.getReferenceById(machineId));
        reading.setTemperature(temperature);
        reading.setHumidity(humidity);
        reading.setRecordedAt(now);
        readings.save(reading);
        events.publishEvent(new TelemetryRecordedEvent(machineId, temperature, humidity, now));
    }

    /** null when absent; finite number, rounded HALF_UP to 2 decimals, inside the sensor range. */
    private static BigDecimal value(JsonNode node, BigDecimal min, BigDecimal max, String name) throws MachineEnvelope.Invalid {
        if (node.isMissingNode() || node.isNull()) return null;
        if (!node.isNumber() || (node.isFloatingPointNumber() && !Double.isFinite(node.doubleValue())))
            throw new MachineEnvelope.Invalid(name + " must be a finite number");
        BigDecimal value = node.decimalValue().setScale(2, RoundingMode.HALF_UP);
        if (value.compareTo(min) < 0 || value.compareTo(max) > 0) throw new MachineEnvelope.Invalid(name + " is outside " + min + " .. " + max);
        return value;
    }

    private boolean seenBefore(UUID machineId, String messageId, Instant now) {
        Instant oldest = now.minus(properties.duplicateWindow());
        if (seenMessages.size() > PRUNE_ABOVE) seenMessages.values().removeIf(seen -> seen.isBefore(oldest));
        AtomicBoolean repeat = new AtomicBoolean();
        seenMessages.compute(machineId + " " + messageId, (key, seen) -> {
            if (seen != null && !seen.isBefore(oldest)) {
                repeat.set(true);
                return seen;
            }
            return now;
        });
        return repeat.get();
    }

    private boolean takeSlot(UUID machineId, Instant now) {
        AtomicBoolean taken = new AtomicBoolean();
        lastStored.compute(machineId, (id, last) -> {
            if (last != null && now.isBefore(last.plus(properties.minInterval()))) return last;
            taken.set(true);
            return now;
        });
        return taken.get();
    }
}
