package com.fruitmachine.backend.machine.dto.slot;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.fruitmachine.backend.machine.enums.SlotStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@Schema(description = "Set slot status without changing parent machine status or deleting histories.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record UpdateMachineSlotStatusRequest(
        @NotNull @Schema(description = "ACTIVE, INACTIVE or ERROR. ADMIN sets ERROR manually; no automatic hardware detection.", example = "INACTIVE")
        @JsonDeserialize(using = SlotRequestDeserializers.Status.class) SlotStatus status) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
