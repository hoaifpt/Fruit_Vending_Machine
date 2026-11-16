package com.fruitmachine.backend.sensor.dto;

import com.fruitmachine.backend.machine.enums.MachineConnectivity;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "Latest telemetry reading of a machine with its status against the machine thresholds, and the machine connectivity. "
        + "Reading fields are null when the machine has no reading yet. Display only, not an alert.")
public record TelemetryLatestResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Machine UUID.") UUID machineId,
        @Schema(description = "Backend receive instant of the reading, UTC; null when there is no reading.", types = {"string", "null"}, format = "date-time") Instant recordedAt,
        @Schema(description = "Temperature in Celsius, 2 decimals; null when not reported.", types = {"number", "null"}, example = "4.70") BigDecimal temperature,
        @Schema(description = "Relative humidity in percent, 2 decimals; null when not reported.", types = {"number", "null"}, example = "68.20") BigDecimal humidity,
        @Schema(description = "Temperature against minTemperature/maxTemperature of the machine; null when there is no temperature.", types = {"string", "null"}, allowableValues = {"LOW", "NORMAL", "HIGH"}) ReadingStatus temperatureStatus,
        @Schema(description = "Humidity against minHumidity/maxHumidity of the machine; null when there is no humidity.", types = {"string", "null"}, allowableValues = {"LOW", "NORMAL", "HIGH"}) ReadingStatus humidityStatus,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Derived connectivity of the machine now.") MachineConnectivity connectivity) { }
