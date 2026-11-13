package com.fruitmachine.backend.pricing.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.fruitmachine.backend.inventory.dto.InventoryQuantityDeserializer;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

@Schema(description = "Whole replacement of the setting. version is the value last read; unknown fields are rejected.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record UpdateNearExpiryDiscountRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, example = "true") Boolean enabled,
        @NotNull @Min(1) @Max(90) @JsonDeserialize(using = InventoryQuantityDeserializer.class)
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Integer 1 to 90.", minimum = "1", maximum = "90", example = "50") Integer percent,
        @NotNull @Min(0) @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "version from the last GET.", example = "3") Long version) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
