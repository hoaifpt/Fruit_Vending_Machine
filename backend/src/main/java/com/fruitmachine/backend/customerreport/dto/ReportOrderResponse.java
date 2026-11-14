package com.fruitmachine.backend.customerreport.dto;

import com.fruitmachine.backend.order.enums.OrderStatus;
import java.util.UUID;

public record ReportOrderResponse(UUID id, String orderCode, OrderStatus status) {
}
