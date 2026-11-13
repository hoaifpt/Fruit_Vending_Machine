package com.fruitmachine.backend.maintenance.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;

@Schema(description = "Optional body of a RESET: a note on what was checked. Unknown fields are rejected.", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record ResetMachineRequest(
        @Size(max = 500) @Schema(description = "At most 500 characters; blank means none.", types = {"string", "null"}, maxLength = 500,
                example = "Gates checked, jam cleared") String note) {
    public ResetMachineRequest {
        note = note == null || note.isBlank() ? null : note.strip();
    }

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
