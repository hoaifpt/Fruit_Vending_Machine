package com.fruitmachine.backend.pricing.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

@Schema(description = "Near-expiry discount: bowls whose batch expires today (businessZone) cost floor(price x (100 - percent) / 100) VND while enabled.")
public record NearExpiryDiscountResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean enabled,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "1", maximum = "90", example = "50") int percent,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Send it back on PUT; a stale value is 409.", example = "3") long version,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant updatedAt,
        @Schema(description = "Last Admin who changed it; null for the seeded value.", nullable = true) PricingActorResponse updatedBy,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Zone that decides \"today\".", example = "Asia/Ho_Chi_Minh") String businessZone) {
}
