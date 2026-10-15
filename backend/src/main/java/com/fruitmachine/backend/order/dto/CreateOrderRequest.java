package com.fruitmachine.backend.order.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

@Schema(description = "Kiosk order. The machine comes from the kiosk credential and prices from the database; "
        + "machineId, price, status, orderCode and slot/inventory ids are rejected as unknown fields.",
        additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record CreateOrderRequest(
        @NotNull @Size(min = 1, max = 10) @Schema(description = "1..10 lines with distinct productId.") List<@NotNull @Valid CreateOrderItemRequest> items) {
    @JsonAnySetter
    public void rejectUnknown(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
