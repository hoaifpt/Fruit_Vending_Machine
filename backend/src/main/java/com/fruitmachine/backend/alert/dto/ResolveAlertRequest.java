package com.fruitmachine.backend.alert.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;

@Schema(description = "Optional resolution note. The body may be omitted.", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record ResolveAlertRequest(
        @Size(max = 500) @Schema(description = "What was done, at most 500 characters; blank means no note.", maxLength = 500,
                types = {"string", "null"}, example = "Cleared the jam in column A and tested a dispense") String note) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
