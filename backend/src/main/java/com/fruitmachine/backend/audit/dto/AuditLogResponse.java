package com.fruitmachine.backend.audit.dto;

import com.fasterxml.jackson.databind.JsonNode;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "One audit log entry. userId/userEmail are null when the system made the change; actor then says \"system\".")
public record AuditLogResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Audit entry UUID.") UUID id,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "What happened, for example ROLE_PERMISSIONS_CHANGED, MACHINE_MAINTENANCE_AUTO, "
                + "DISPENSE_SUCCESS_AFTER_REFUND, PAYMENT_LATE.", example = "MACHINE_MAINTENANCE_AUTO") String action,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Kind of record changed, for example Role, Machine, DispenseCommand, Payment.", example = "Machine") String entityType,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "UUID of the record changed (no foreign key: the record may be of any kind).") UUID entityId,
        @Schema(description = "Acting user; null for system changes.", types = {"string", "null"}, format = "uuid") UUID userId,
        @Schema(description = "Email of the acting user; null for system changes.", types = {"string", "null"}, example = "admin@example.com") String userEmail,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "userEmail, or \"system\" when no user made the change.", example = "system") String actor,
        @Schema(description = "State before the change, as recorded; null when not recorded.", types = {"object", "null"}) JsonNode oldValue,
        @Schema(description = "State after the change, as recorded; null when not recorded.", types = {"object", "null"}) JsonNode newValue,
        @Schema(description = "Client IP address when recorded; null otherwise.", types = {"string", "null"}) String ipAddress,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Instant of the change, UTC.") Instant createdAt) { }
