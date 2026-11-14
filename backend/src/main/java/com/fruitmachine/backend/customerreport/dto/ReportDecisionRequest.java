package com.fruitmachine.backend.customerreport.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fruitmachine.backend.customerreport.enums.ReportResolution;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** resolve: FIXED, NO_ACTION_NEEDED or REFUNDED; reject: SPAM or DUPLICATE. */
@Schema(additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record ReportDecisionRequest(@NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) ReportResolution resolution,
        @Size(max = 1000) @Schema(types = {"string", "null"}, maxLength = 1000) String note) {
    public ReportDecisionRequest {
        note = note == null || note.isBlank() ? null : note.strip();
    }

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
