package com.fruitmachine.backend.restock.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.fruitmachine.backend.inventory.dto.InventoryQuantityDeserializer;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@Schema(description = "Bowls physically loaded into the line's column from one batch.", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record RestockLoadRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, format = "uuid") UUID batchId,
        @NotNull @Min(1) @Max(1000) @JsonDeserialize(using = InventoryQuantityDeserializer.class)
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "1", maximum = "1000", example = "4") Integer quantity,
        @Schema(types = {"boolean", "null"}, description = "Load anyway although the batch expires earlier than bowls already in the column "
                + "(it will be sold after them). Default false: 409 EXPIRY_INVERSION.") Boolean acknowledgeExpiryInversion) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
