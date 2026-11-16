package com.fruitmachine.backend.workorder.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@Schema(description = "The version from the last read; stale -> 409.", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record VersionRequest(@NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Long version) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
