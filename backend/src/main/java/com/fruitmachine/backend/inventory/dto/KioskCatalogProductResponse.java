package com.fruitmachine.backend.inventory.dto;

import com.fruitmachine.backend.pricing.enums.DiscountReason;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.util.UUID;

public record KioskCatalogProductResponse(UUID productId, String sku, String name, String description,
        @Schema(description = "Issue #61: what the customer pays for the next bowl (the FEFO head that would be reserved now), after any near-expiry discount. The order may still differ (midnight, setting change, head change): show the order's totalAmount before the QR.") BigDecimal price,
        @Schema(description = "Product price before any discount.") BigDecimal originalPrice,
        @Schema(description = "0, or the current near-expiry percent when the next bowl expires today. Show the badge and strike-through only when > 0.", minimum = "0", maximum = "90") int discountPercent,
        DiscountReason discountReason,
        String imageUrl,
        @Schema(description = "Display snapshot, NOT a reservation: AVAILABLE bowls of this product that outlive the reservation hold, counted only in slots whose head (next bowl to dispense) is a sellable bowl of this product. Bowls behind a blocked head are not counted.") long availableQuantity) {
}
