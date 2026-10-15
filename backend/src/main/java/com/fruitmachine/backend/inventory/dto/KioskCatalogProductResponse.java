package com.fruitmachine.backend.inventory.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.util.UUID;

public record KioskCatalogProductResponse(UUID productId, String sku, String name, String description, BigDecimal price,
        String imageUrl,
        @Schema(description = "Snapshot of sellable bowls on this machine, NOT a reservation.") long availableQuantity) {
}
