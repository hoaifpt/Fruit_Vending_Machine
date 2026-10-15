package com.fruitmachine.backend.order.service;

import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.inventory.entity.InventoryItem;
import com.fruitmachine.backend.inventory.entity.InventoryTransaction;
import com.fruitmachine.backend.inventory.enums.InventoryStatus;
import com.fruitmachine.backend.inventory.enums.InventoryTransactionType;
import com.fruitmachine.backend.inventory.repository.InventoryItemRepository;
import com.fruitmachine.backend.inventory.repository.InventoryTransactionRepository;
import com.fruitmachine.backend.order.entity.Order;
import com.fruitmachine.backend.order.entity.OrderItem;
import com.fruitmachine.backend.order.entity.OrderItemAllocation;
import com.fruitmachine.backend.order.enums.AllocationStatus;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.order.repository.OrderItemAllocationRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Inventory side effects of an order: reserve physical bowls and release them again. Callers own the
 * transaction and must already hold the order lock (lock order: Order, then InventoryItem).
 */
@Service
@RequiredArgsConstructor
public class OrderReservationService {
    public static final String REASON_CANCELLED = "ORDER_CANCELLED";
    public static final String REASON_EXPIRED = "RESERVATION_EXPIRED";

    private final InventoryItemRepository items;
    private final InventoryTransactionRepository history;
    private final OrderItemAllocationRepository allocations;

    /** FEFO bowls locked with SKIP LOCKED; fewer than requested means the whole order must fail. */
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public List<InventoryItem> selectBowls(UUID machineId, UUID productId, int quantity, Instant holdDeadline) {
        List<InventoryItem> bowls = items.findReservationCandidates(machineId, productId, holdDeadline, quantity);
        if (bowls.size() < quantity) throw new ConflictException("Insufficient sellable quantity for a requested product");
        return bowls;
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public void reserve(Order order, OrderItem line, List<InventoryItem> bowls, Instant now) {
        for (InventoryItem bowl : bowls) {
            bowl.setStatus(InventoryStatus.RESERVED);
            bowl.setReservedAt(now);
            var allocation = new OrderItemAllocation();
            allocation.setOrderItem(line);
            allocation.setInventoryItem(bowl);
            allocation.setStatus(AllocationStatus.RESERVED);
            allocations.save(allocation);
            append(bowl, order, InventoryTransactionType.RESERVE, null, InventoryStatus.AVAILABLE, InventoryStatus.RESERVED);
        }
    }

    /** PENDING_PAYMENT to CANCELLED, returning every RESERVED bowl to AVAILABLE with RETURN history. */
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public void release(Order order, String reason, Instant now) {
        // created_at comes from the database clock; never let clock skew violate cancelled_at >= created_at.
        order.setStatus(OrderStatus.CANCELLED);
        order.setCancelledAt(notBefore(now, order.getCreatedAt()));
        for (OrderItemAllocation allocation : allocations.findByOrderIdAndStatus(order.getId(), AllocationStatus.RESERVED)) {
            InventoryItem bowl = items.findForUpdateById(allocation.getInventoryItem().getId())
                    .orElseThrow(() -> new IllegalStateException("Allocated inventory item is missing"));
            if (bowl.getStatus() != InventoryStatus.RESERVED) throw new IllegalStateException("Allocated inventory item is not RESERVED");
            allocation.setStatus(AllocationStatus.RELEASED);
            allocation.setReleasedAt(notBefore(now, allocation.getCreatedAt()));
            bowl.setStatus(InventoryStatus.AVAILABLE);
            bowl.setReservedAt(null);
            append(bowl, order, InventoryTransactionType.RETURN, reason, InventoryStatus.RESERVED, InventoryStatus.AVAILABLE);
        }
        items.flush();
        history.flush();
    }

    private static Instant notBefore(Instant candidate, Instant floor) {
        return floor != null && candidate.isBefore(floor) ? floor : candidate;
    }

    private void append(InventoryItem bowl, Order order, InventoryTransactionType type, String reason,
            InventoryStatus before, InventoryStatus after) {
        var event = new InventoryTransaction();
        event.setInventoryItem(bowl);
        // Location snapshot; the kiosk is not a user, so performedBy stays NULL.
        event.setMachineId(order.getMachine().getId());
        event.setSlotId(bowl.getSlotId());
        event.setType(type);
        event.setReferenceId(order.getId());
        event.setReason(reason);
        event.setStatusBefore(before);
        event.setStatusAfter(after);
        history.save(event);
    }
}
