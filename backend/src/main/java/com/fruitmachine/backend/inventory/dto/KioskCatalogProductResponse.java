package com.fruitmachine.backend.inventory.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.util.UUID;

public record KioskCatalogProductResponse(UUID productId, String sku, String name, String description, BigDecimal price,
        String imageUrl,
        @Schema(description = "Display snapshot, NOT a reservation: AVAILABLE bowls of this product that outlive the reservation hold, counted only in slots whose head (next bowl to dispense) is a sellable bowl of this product. Bowls behind a blocked head are not counted.") long availableQuantity) {
}
