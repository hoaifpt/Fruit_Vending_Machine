package com.fruitmachine.backend.inventory.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.*;
import java.util.UUID;

@Schema(description = "Registers physically loaded and confirmed boxes. No hardware action. Creator comes from JWT; unknown fields rejected.", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record LoadInventoryRequest(@NotNull UUID batchId, @NotNull UUID slotId,
        @NotNull @Positive @Max(1000) @JsonDeserialize(using = InventoryQuantityDeserializer.class)
        @Schema(description = "JSON integer token, 1..1000 per request; bounded bulk operation, independent of hardware capacity.", minimum = "1", maximum = "1000", example = "4") Integer quantity) {
    @JsonAnySetter public void rejectUnknown(String field, Object value) { throw new IllegalArgumentException("Unknown request field"); }
}
