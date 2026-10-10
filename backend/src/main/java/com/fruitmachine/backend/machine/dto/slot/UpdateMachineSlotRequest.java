package com.fruitmachine.backend.machine.dto.slot;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;

@Schema(description = "Replace capacity only. Identity, parent, slot code, status and timestamps are rejected.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record UpdateMachineSlotRequest(
        @NotNull @Positive
        @JsonDeserialize(using = SlotRequestDeserializers.Capacity.class)
        @Schema(description = "Maximum physical capacity, not current stock. Positive 32-bit integer. Inventory occupancy checks are deferred to Inventory Management.",
                minimum = "1", maximum = "2147483647", example = "8") Integer capacity) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
