package com.fruitmachine.backend.workorder.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@Schema(additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CancelWorkOrderRequest(
        @NotBlank @Size(max = 500) @Schema(requiredMode = Schema.RequiredMode.REQUIRED, maxLength = 500) String reason,
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Long version) {
    public CancelWorkOrderRequest {
        reason = reason == null ? null : reason.strip();
    }

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
