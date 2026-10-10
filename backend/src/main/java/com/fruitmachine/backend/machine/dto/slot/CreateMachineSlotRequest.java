package com.fruitmachine.backend.machine.dto.slot;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;
import java.util.Locale;

@Schema(description = "Configure a slot on an existing machine; initial status ACTIVE.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CreateMachineSlotRequest(
        @NotBlank @Size(min = 1, max = 32)
        @Schema(description = "Stable code within the parent machine; stripped and uppercased using Locale.ROOT. No hardware naming restriction.", example = "A1") String slotCode,
        @NotNull @Positive
        @JsonDeserialize(using = SlotRequestDeserializers.Capacity.class)
        @Schema(description = "Maximum physical capacity, not current stock. Positive 32-bit integer.", minimum = "1", maximum = "2147483647", example = "6") Integer capacity) {
    public CreateMachineSlotRequest {
        slotCode = slotCode == null ? null : slotCode.strip().toUpperCase(Locale.ROOT);
    }
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
