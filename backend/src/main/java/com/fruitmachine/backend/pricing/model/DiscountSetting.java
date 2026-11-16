package com.fruitmachine.backend.pricing.model;

/** A snapshot of the near-expiry discount setting, read once per request or order and passed to the pricing rule. */
public record DiscountSetting(boolean enabled, int percent) {
    public DiscountSetting {
        if (percent < 1 || percent > 90) throw new IllegalArgumentException("Near-expiry discount percent must be 1 to 90");
    }
}
