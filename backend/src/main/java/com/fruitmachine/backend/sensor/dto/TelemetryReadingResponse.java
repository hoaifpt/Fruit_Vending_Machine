package com.fruitmachine.backend.sensor.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;

@Schema(description = "One stored telemetry reading; at least one value is present.")
public record TelemetryReadingResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Backend receive instant, UTC.") Instant recordedAt,
        @Schema(description = "Temperature in Celsius, 2 decimals; null when not reported.", types = {"number", "null"}, example = "4.70") BigDecimal temperature,
        @Schema(description = "Relative humidity in percent, 2 decimals; null when not reported.", types = {"number", "null"}, example = "68.20") BigDecimal humidity) { }
