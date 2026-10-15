package com.fruitmachine.backend.order.dto;

import java.math.BigDecimal;
import java.util.UUID;

public record KioskOrderItemResponse(UUID productId, String sku, String productName, int quantity, BigDecimal unitPrice,
        BigDecimal totalPrice) {
}
