package com.fruitmachine.backend.pricing.model;

import com.fruitmachine.backend.pricing.enums.DiscountReason;
import java.math.BigDecimal;

/** The price of one bowl: product price, price charged (whole VND), applied percent (0 when none) and the reason. */
public record BowlPrice(BigDecimal originalPrice, BigDecimal unitPrice, int discountPercent, DiscountReason reason) {
    public BigDecimal discountAmount() {
        return originalPrice.subtract(unitPrice);
    }

    public boolean discounted() {
        return reason != DiscountReason.NONE;
    }
}
