package com.fruitmachine.backend.order.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@Schema(description = "Kiosk order for exactly ONE fruit bowl (one purchase = one bowl). The machine comes from the kiosk credential, "
        + "the price from the database and the physical bowl is chosen by the backend; items, quantity, machineId, price, status, "
        + "orderCode and slot/inventory ids are rejected as unknown fields. Breaking change of issue #35: the former items[] shape is no longer accepted.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CreateOrderRequest(
        @NotNull @Schema(description = "Product UUID from the kiosk catalog.", example = "1c2d3e4f-0000-4000-8000-000000000001",
                requiredMode = Schema.RequiredMode.REQUIRED) UUID productId) {
    @JsonAnySetter
    public void rejectUnknown(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
