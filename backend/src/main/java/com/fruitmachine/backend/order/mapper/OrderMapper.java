package com.fruitmachine.backend.order.mapper;

import com.fruitmachine.backend.order.dto.*;
import com.fruitmachine.backend.order.entity.Order;
import com.fruitmachine.backend.order.entity.OrderItem;
import com.fruitmachine.backend.order.entity.OrderItemAllocation;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class OrderMapper {
    private static final Comparator<OrderItem> LINE_ORDER =
            Comparator.comparing((OrderItem item) -> item.getProduct().getSku()).thenComparing(OrderItem::getId);

    public KioskOrderResponse kiosk(Order order) {
        List<KioskOrderItemResponse> lines = order.getItems().stream().sorted(LINE_ORDER)
                .map(item -> new KioskOrderItemResponse(item.getProduct().getId(), item.getProduct().getSku(), item.getProduct().getName(),
                        item.getQuantity(), item.getUnitPrice(), item.getTotalPrice()))
                .toList();
        return new KioskOrderResponse(order.getId(), order.getOrderCode(), order.getMachine().getId(), order.getStatus(), lines,
                order.getSubtotal(), order.getTotalAmount(), order.getCreatedAt(), order.getExpiresAt(), order.getCancelledAt());
    }

    public OrderSummaryResponse summary(Order order, long lines, long bowls) {
        return new OrderSummaryResponse(order.getId(), order.getOrderCode(), order.getMachine().getId(), order.getMachine().getCode(),
                order.getStatus(), lines, bowls, order.getTotalAmount(), order.getCreatedAt(), order.getExpiresAt(), order.getCancelledAt());
    }

    public OrderDetailResponse detail(Order order, Map<UUID, List<OrderItemAllocation>> allocations) {
        List<OrderItemDetailResponse> lines = order.getItems().stream().sorted(LINE_ORDER)
                .map(item -> new OrderItemDetailResponse(item.getId(), item.getProduct().getId(), item.getProduct().getSku(),
                        item.getProduct().getName(), item.getQuantity(), item.getUnitPrice(), item.getTotalPrice(),
                        allocations.getOrDefault(item.getId(), List.of()).stream().map(this::allocation).toList()))
                .toList();
        return new OrderDetailResponse(order.getId(), order.getOrderCode(), order.getMachine().getId(), order.getMachine().getCode(),
                order.getStatus(), order.getSubtotal(), order.getTotalAmount(), order.getCreatedAt(), order.getExpiresAt(),
                order.getPaidAt(), order.getCompletedAt(), order.getCancelledAt(), lines);
    }

    private OrderAllocationResponse allocation(OrderItemAllocation allocation) {
        var item = allocation.getInventoryItem();
        return new OrderAllocationResponse(allocation.getId(), item.getId(), item.getSlot() == null ? null : item.getSlot().getSlotCode(),
                item.getBatch().getBatchCode(), item.getBatch().getExpiresAt(), allocation.getStatus(), allocation.getReleasedAt());
    }
}
