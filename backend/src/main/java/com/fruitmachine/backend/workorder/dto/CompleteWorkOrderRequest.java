package com.fruitmachine.backend.workorder.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import jakarta.validation.constraints.Size;

@Schema(additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CompleteWorkOrderRequest(
        @NotBlank @Size(max = 2000) @Schema(requiredMode = Schema.RequiredMode.REQUIRED, maxLength = 2000, example = "Thay servo 2") String resultNote,
        @Schema(types = {"boolean", "null"}, description = "Resolve the linked OPEN/ACKNOWLEDGED alerts. Default true.") Boolean resolveLinkedAlerts,
        @Valid @Schema(description = "Issue #68, RESTOCK: a reason for each line whose loaded quantity differs from the planned one.") List<LineVariance> lineVariances) {
    public CompleteWorkOrderRequest {
        resultNote = resultNote == null ? null : resultNote.strip();
    }

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
