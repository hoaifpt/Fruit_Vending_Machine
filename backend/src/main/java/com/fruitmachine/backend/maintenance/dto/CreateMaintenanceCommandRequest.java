package com.fruitmachine.backend.maintenance.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fruitmachine.backend.maintenance.enums.MaintenanceOperation;
import com.fruitmachine.backend.maintenance.enums.MaintenanceReason;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

@Schema(description = "A maintenance command for one column. RESET is not accepted here (POST /api/v1/machines/{machineId}/reset). Unknown fields are rejected.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CreateMaintenanceCommandRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"REMOVE_ITEM", "EMPTY_COLUMN", "OPEN_REFILL", "CLOSE_REFILL"},
                example = "REMOVE_ITEM") MaintenanceOperation operation,
        @Schema(description = "Required for REMOVE_ITEM and EMPTY_COLUMN, not allowed otherwise.", types = {"string", "null"}, example = "DAMAGED") MaintenanceReason reason,
        @Size(max = 500) @Schema(description = "Optional, at most 500 characters; required when reason is OTHER. Blank means none.", types = {"string", "null"},
                maxLength = 500) String note,
        @Schema(description = "REMOVE_ITEM only, optional: must be the current head bowl of the column (409 NOT_HEAD_ITEM otherwise).",
                types = {"string", "null"}, format = "uuid") UUID inventoryItemId,
        @Schema(description = "Issue #68, optional: the IN_PROGRESS work order of this machine the command serves; the caller must be allowed to execute it.",
                types = {"string", "null"}, format = "uuid") UUID workOrderId) {
    public CreateMaintenanceCommandRequest {
        note = note == null || note.isBlank() ? null : note.strip();
    }

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
