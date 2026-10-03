package com.fruitmachine.backend.order.enums;

import com.fruitmachine.backend.order.entity.Order;

public enum OrderStatus {
    PENDING_PAYMENT, PAID, DISPENSING, COMPLETED, CANCELLED, PAYMENT_FAILED, DISPENSE_FAILED, REFUNDED
}
