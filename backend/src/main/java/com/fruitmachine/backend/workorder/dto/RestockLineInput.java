package com.fruitmachine.backend.workorder.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.fruitmachine.backend.inventory.dto.InventoryQuantityDeserializer;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@Schema(description = "Issue #68: one planned restock line: a slot of the work order's machine, an ACTIVE product, at most the slot capacity.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record RestockLineInput(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, format = "uuid") UUID slotId,
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, format = "uuid") UUID productId,
        @NotNull @Min(0) @Max(1000) @JsonDeserialize(using = InventoryQuantityDeserializer.class)
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0", maximum = "1000", example = "6") Integer plannedQuantity) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
