package com.fruitmachine.backend.order.dto;

import com.fruitmachine.backend.pricing.enums.DiscountReason;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

public record OrderItemDetailResponse(UUID id, UUID productId, String sku, String productName, int quantity,
        @Schema(description = "Product price when the bowl was reserved.") BigDecimal originalUnitPrice,
        @Schema(description = "Price charged for one bowl.") BigDecimal unitPrice, BigDecimal totalPrice,
        @Schema(description = "0 without a discount.", minimum = "0", maximum = "90") int discountPercent,
        DiscountReason discountReason, List<OrderAllocationResponse> allocations) {
}
