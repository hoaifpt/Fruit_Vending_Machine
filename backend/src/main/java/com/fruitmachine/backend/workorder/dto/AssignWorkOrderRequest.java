package com.fruitmachine.backend.workorder.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@Schema(additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record AssignWorkOrderRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, format = "uuid", description = "An ACTIVE user holding WORK_ORDER_EXECUTE.") UUID assigneeId,
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Long version) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
