package com.fruitmachine.backend.machine.dto;

import com.fruitmachine.backend.machine.enums.MachineStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "Machine identity, administrative status and environmental configuration; no slot/inventory/telemetry collections.")
public record MachineResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Machine UUID.") UUID id,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Immutable business code.", example = "FV-HCM-001") String code,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Machine name.") String name,
        @Schema(description = "Installation location; legacy database rows may be null.", types = {"string", "null"}) String location,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Administrative status, not connectivity.") MachineStatus status,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Configured minimum Celsius threshold.") BigDecimal minTemperature,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Configured maximum Celsius threshold.") BigDecimal maxTemperature,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Configured minimum humidity percentage.") BigDecimal minHumidity,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Configured maximum humidity percentage.") BigDecimal maxHumidity,
        @Schema(description = "System-managed last communication instant, UTC; null until heartbeat exists. Read-only.", types = {"string", "null"}, format = "date-time") Instant lastSeenAt,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Creation instant, UTC.") Instant createdAt,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Modification instant, UTC.") Instant updatedAt) { }
