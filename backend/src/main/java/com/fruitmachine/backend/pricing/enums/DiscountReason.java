package com.fruitmachine.backend.pricing.enums;

/** Why a bowl was sold below its product price. Stored in order_items.discount_reason (CHECK NONE / NEAR_EXPIRY). */
public enum DiscountReason {
    NONE,
    NEAR_EXPIRY
}
