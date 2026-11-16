package com.fruitmachine.backend.workorder.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

@Schema(description = "Issue #68: why a restock line was loaded with another quantity than planned.", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record LineVariance(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, format = "uuid") UUID lineId,
        @NotBlank @Size(max = 500) @Schema(requiredMode = Schema.RequiredMode.REQUIRED, maxLength = 500, example = "Lô mới chỉ có 4 tô") String reason) {
    public LineVariance {
        reason = reason == null ? null : reason.strip();
    }

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
