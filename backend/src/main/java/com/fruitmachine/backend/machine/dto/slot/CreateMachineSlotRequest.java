package com.fruitmachine.backend.machine.dto.slot;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;
import java.util.Locale;

@Schema(description = "Configure a slot on an existing machine; initial status ACTIVE. A slot is one physical column of the machine, so a machine has at most two slots.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CreateMachineSlotRequest(
        @NotBlank @Pattern(regexp = "[AB]", message = "must be A or B")
        @Schema(description = "Physical column of the machine: A or B, unique within the parent machine. Stripped and uppercased using Locale.ROOT before validation. Sent to the machine as columnCode of dispense commands.",
                allowableValues = {"A", "B"}, example = "A") String slotCode,
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
