package com.fruitmachine.backend.workorder.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record WorkOrderNoteRequest(@NotBlank @Size(max = 2000) @Schema(requiredMode = Schema.RequiredMode.REQUIRED, maxLength = 2000) String note) {
    public WorkOrderNoteRequest {
        note = note == null ? null : note.strip();
    }

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
