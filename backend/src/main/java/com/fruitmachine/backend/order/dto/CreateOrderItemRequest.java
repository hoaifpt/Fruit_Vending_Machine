package com.fruitmachine.backend.order.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@Schema(description = "One product line. The backend chooses the physical bowls; unknown fields are rejected.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CreateOrderItemRequest(
        @NotNull @Schema(description = "Product UUID from the kiosk catalog; distinct across lines.", example = "1c2d3e4f-0000-4000-8000-000000000001") UUID productId,
        @NotNull @Min(1) @JsonDeserialize(using = OrderQuantityDeserializer.class)
        @Schema(description = "JSON integer >= 1. The sum over all lines may not exceed the configured maximum.", minimum = "1", example = "2") Integer quantity) {
    @JsonAnySetter
    public void rejectUnknown(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
