package com.fruitmachine.backend.order.service;

import com.fruitmachine.backend.order.entity.Order;
import com.fruitmachine.backend.order.enums.OrderStatus;
import java.time.Instant;
import java.util.Set;

/** Order transitions owned by other flows (issue #72). REFUNDED is final: nothing moves an order out of it. */
public final class OrderTransitions {
    private static final Set<OrderStatus> REFUNDABLE = Set.of(OrderStatus.DISPENSE_FAILED, OrderStatus.COMPLETED);

    private OrderTransitions() {
    }

    public static boolean refundable(Order order) {
        return REFUNDABLE.contains(order.getStatus());
    }

    /** DISPENSE_FAILED / COMPLETED -> REFUNDED; called only by RefundService under the order lock. */
    public static void refund(Order order, Instant at) {
        if (!refundable(order)) throw new IllegalStateException("Illegal order transition " + order.getStatus() + " to " + OrderStatus.REFUNDED);
        order.setStatus(OrderStatus.REFUNDED);
        order.setRefundedAt(at);
    }
}
