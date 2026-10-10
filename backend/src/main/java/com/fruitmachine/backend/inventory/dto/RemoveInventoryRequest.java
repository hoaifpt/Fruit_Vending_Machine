package com.fruitmachine.backend.inventory.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;

@Schema(description = "Confirms physical removal; reason is stored on append-only per-item history. Actor is server-controlled.", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record RemoveInventoryRequest(@NotBlank @Size(min = 1, max = 500)
        @Schema(description = "Nonblank reason, stripped, maximum 500 characters.", example = "Expired fruit removed during maintenance") String reason) {
    public RemoveInventoryRequest { reason = reason == null ? null : reason.strip(); }
    @JsonAnySetter public void rejectUnknown(String field, Object value) { throw new IllegalArgumentException("Unknown request field"); }
}
