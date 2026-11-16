package com.fruitmachine.backend.sensor.service;

import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.machine.service.ConnectivityEvaluator;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.sensor.dto.ReadingStatus;
import com.fruitmachine.backend.sensor.dto.TelemetryLatestResponse;
import com.fruitmachine.backend.sensor.dto.TelemetryPageResponse;
import com.fruitmachine.backend.sensor.dto.TelemetryReadingResponse;
import com.fruitmachine.backend.sensor.entity.SensorReading;
import com.fruitmachine.backend.sensor.repository.SensorReadingRepository;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read side of telemetry for ADMIN/STAFF (MACHINE_READ): latest reading and paged history, both straight from the database. */
@Service
@RequiredArgsConstructor
public class TelemetryQueryService {
    public static final Duration MAX_RANGE = Duration.ofDays(31);
    public static final int MAX_PAGE_SIZE = 500;

    private final MachineRepository machines;
    private final SensorReadingRepository readings;
    private final ConnectivityEvaluator connectivity;

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_MACHINE_READ)
    public TelemetryLatestResponse latest(UUID machineId) {
        var machine = machines.findById(machineId).orElseThrow(TelemetryQueryService::missing);
        var reading = readings.findFirstByMachine_IdOrderByRecordedAtDescIdDesc(machineId).orElse(null);
        BigDecimal temperature = reading == null ? null : reading.getTemperature(), humidity = reading == null ? null : reading.getHumidity();
        return new TelemetryLatestResponse(machineId, reading == null ? null : reading.getRecordedAt(), temperature, humidity,
                status(temperature, machine.getTemperatureMin(), machine.getTemperatureMax()),
                status(humidity, machine.getHumidityMin(), machine.getHumidityMax()), connectivity.evaluate(machine));
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_MACHINE_READ)
    public TelemetryPageResponse history(UUID machineId, Instant from, Instant to, int page, int size) {
        if (from == null || to == null) throw new BadRequestException("from and to are required");
        if (!to.isAfter(from)) throw new BadRequestException("to must be after from");
        if (Duration.between(from, to).compareTo(MAX_RANGE) > 0) throw new BadRequestException("The time range must not exceed 31 days");
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) throw new BadRequestException("Page must be nonnegative and size must be between 1 and 500");
        if (!machines.existsById(machineId)) throw missing();
        var result = readings.findHistory(machineId, from, to,
                PageRequest.of(page, size, Sort.by(Sort.Order.desc("recordedAt"), Sort.Order.desc("id"))));
        return new TelemetryPageResponse(result.getContent().stream().map(TelemetryQueryService::toResponse).toList(),
                page, size, result.getTotalElements(), result.getTotalPages());
    }

    static ReadingStatus status(BigDecimal value, BigDecimal min, BigDecimal max) {
        if (value == null) return null;
        if (value.compareTo(min) < 0) return ReadingStatus.LOW;
        if (value.compareTo(max) > 0) return ReadingStatus.HIGH;
        return ReadingStatus.NORMAL;
    }

    private static TelemetryReadingResponse toResponse(SensorReading reading) {
        return new TelemetryReadingResponse(reading.getRecordedAt(), reading.getTemperature(), reading.getHumidity());
    }

    private static ResourceNotFoundException missing() {
        return new ResourceNotFoundException("Machine not found");
    }
}
