package com.fruitmachine.backend.machine.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@Schema(description = "Set administrative machine status without deleting histories.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record UpdateMachineStatusRequest(
        @NotNull @Schema(description = "ACTIVE, INACTIVE or MAINTENANCE; administrative configuration, not connectivity.", example = "MAINTENANCE")
        MachineStatus status) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
