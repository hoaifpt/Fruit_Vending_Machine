package com.fruitmachine.backend.alert.dto;

import com.fruitmachine.backend.alert.enums.AlertSeverity;
import com.fruitmachine.backend.alert.enums.AlertStatus;
import com.fruitmachine.backend.alert.enums.AlertType;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "One alert. title/message are Vietnamese UI text; type and errorCode let a frontend localize.")
public record AlertResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Alert UUID.") UUID id,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Machine UUID.") UUID machineId,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Machine code.", example = "FV-DEV-001") String machineCode,
        @Schema(description = "Slot UUID for slot alerts (stock, expiry, dispense); null for machine alerts.", types = {"string", "null"}, format = "uuid") UUID slotId,
        @Schema(description = "Slot code (A or B) for slot alerts; null otherwise.", types = {"string", "null"}, example = "A") String slotCode,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Alert type.") AlertType type,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "INFO, WARNING or CRITICAL.") AlertSeverity severity,
        @Schema(description = "Error code for HARDWARE_FAULT (contract codes, REBOOT_<REASON>, MULTIPLE_BOWLS_DETECTED, UNKNOWN_FAULT) and the "
                + "failure reason for DISPENSE_FAILED; null otherwise.", types = {"string", "null"}, example = "SERVO_INIT_FAILED") String errorCode,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Short title.") String title,
        @Schema(description = "Details.", types = {"string", "null"}) String message,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "OPEN, ACKNOWLEDGED or RESOLVED.") AlertStatus status,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "When the problem was detected, UTC.") Instant triggeredAt,
        @Schema(description = "When it was acknowledged, UTC; null if not.", types = {"string", "null"}, format = "date-time") Instant acknowledgedAt,
        @Schema(description = "Email of the user who acknowledged it; null if not acknowledged.", types = {"string", "null"}) String acknowledgedBy,
        @Schema(description = "When it was resolved, UTC; null while unresolved.", types = {"string", "null"}, format = "date-time") Instant resolvedAt,
        @Schema(description = "Email of the user who resolved it, \"system\" when the condition cleared by itself; null while unresolved.",
                types = {"string", "null"}, example = "system") String resolvedBy,
        @Schema(description = "Resolution note; \"Condition cleared\" for system resolutions.", types = {"string", "null"}) String resolutionNote) { }
