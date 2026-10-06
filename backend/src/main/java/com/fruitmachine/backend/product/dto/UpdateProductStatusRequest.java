package com.fruitmachine.backend.product.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fruitmachine.backend.product.enums.ProductStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@Schema(description = "Activate/deactivate catalog product without deleting histories.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record UpdateProductStatusRequest(
        @NotNull @Schema(description = "ACTIVE permits future use; INACTIVE disables new use without deletion.", example = "INACTIVE")
        ProductStatus status) {
    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
