package com.fruitmachine.backend.maintenance.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fruitmachine.backend.maintenance.enums.ReconciliationOutcome;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@Schema(description = "What Staff found at the machine. DONE applies the command's effect as if it had completed; NOT_DONE changes nothing.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record ReconcileMaintenanceCommandRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, example = "DONE") ReconciliationOutcome outcome,
        @Size(max = 500) @Schema(description = "Optional, at most 500 characters.", types = {"string", "null"}, maxLength = 500) String note) {
    public ReconcileMaintenanceCommandRequest {
        note = note == null || note.isBlank() ? null : note.strip();
    }

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
