package com.fruitmachine.backend.payment.refund.dto;

import com.fruitmachine.backend.order.enums.OrderStatus;
import java.util.UUID;

public record RefundOrderResponse(UUID id, String orderCode, OrderStatus status, String machineCode) {
}
