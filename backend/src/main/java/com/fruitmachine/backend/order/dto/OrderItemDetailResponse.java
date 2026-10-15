package com.fruitmachine.backend.order.dto;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

public record OrderItemDetailResponse(UUID id, UUID productId, String sku, String productName, int quantity,
        BigDecimal unitPrice, BigDecimal totalPrice, List<OrderAllocationResponse> allocations) {
}
