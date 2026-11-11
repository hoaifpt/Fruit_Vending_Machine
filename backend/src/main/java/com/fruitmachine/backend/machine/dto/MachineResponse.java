package com.fruitmachine.backend.machine.dto;

import com.fruitmachine.backend.machine.enums.MachineConnectivity;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "Machine identity, administrative status, environmental configuration, derived connectivity and the latest controller diagnostics; no slot/inventory/telemetry collections.")
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
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Derived from presence, never stored: NEVER_SEEN (no message yet), OFFLINE (Last Will after the last message, or silent more than 180 s), WARNING (silent more than 60 s), otherwise ONLINE. Independent of status; does not block sales.") MachineConnectivity connectivity,
        @Schema(description = "System-managed instant of the last valid MQTT message except the OFFLINE Last Will, UTC; null until the machine was heard from. Read-only.", types = {"string", "null"}, format = "date-time") Instant lastSeenAt,
        @Schema(description = "System-managed instant of the last valid heartbeat, UTC; null until the first heartbeat. Read-only.", types = {"string", "null"}, format = "date-time") Instant lastHeartbeatAt,
        @Schema(description = "Firmware version last reported by the machine (heartbeat or status ONLINE). Read-only.", types = {"string", "null"}, example = "0.3.0") String firmwareVersion,
        @Schema(description = "Controller uptime in seconds last reported by the machine. Read-only.", types = {"integer", "null"}, format = "int64", example = "12345") Long uptimeSeconds,
        @Schema(description = "Wi-Fi signal in dBm (-127 to 0) from the last heartbeat; null when not reported, never 0 by default. Read-only.", types = {"integer", "null"}, format = "int32", example = "-55") Integer wifiRssi,
        @Schema(description = "Free controller heap in bytes from the last heartbeat; null when not reported. Read-only.", types = {"integer", "null"}, format = "int64", example = "18240") Long freeHeapBytes,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Creation instant, UTC.") Instant createdAt,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Modification instant, UTC.") Instant updatedAt) { }
