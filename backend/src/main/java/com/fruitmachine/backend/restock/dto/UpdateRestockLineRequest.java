package com.fruitmachine.backend.restock.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.fruitmachine.backend.inventory.dto.InventoryQuantityDeserializer;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.UUID;

@Schema(description = "Partial change of a line that nothing was loaded against yet; a field left out is unchanged.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record UpdateRestockLineRequest(
        @Min(0) @Max(1000) @JsonDeserialize(using = InventoryQuantityDeserializer.class) @Schema(types = {"integer", "null"}, minimum = "0", maximum = "1000") Integer plannedQuantity,
        @Schema(types = {"string", "null"}, format = "uuid") UUID productId) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
