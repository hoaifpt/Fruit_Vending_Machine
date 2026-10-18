package com.fruitmachine.backend.order.service;

import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.inventory.entity.InventoryItem;
import com.fruitmachine.backend.inventory.entity.InventoryTransaction;
import com.fruitmachine.backend.inventory.enums.InventoryStatus;
import com.fruitmachine.backend.inventory.enums.InventoryTransactionType;
import com.fruitmachine.backend.inventory.repository.InventoryItemRepository;
import com.fruitmachine.backend.inventory.repository.InventoryTransactionRepository;
import com.fruitmachine.backend.machine.entity.MachineSlot;
import com.fruitmachine.backend.machine.repository.MachineSlotRepository;
import com.fruitmachine.backend.order.entity.Order;
import com.fruitmachine.backend.order.entity.OrderItem;
import com.fruitmachine.backend.order.entity.OrderItemAllocation;
import com.fruitmachine.backend.order.enums.AllocationStatus;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.order.repository.OrderItemAllocationRepository;
import com.fruitmachine.backend.payment.service.PaymentService;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Inventory side effects of an order: reserve physical bowls and release them again. Callers own the
 * transaction. Reservation lock order: Product, Machine, Slot, InventoryItem; release lock order: Order, Payment, InventoryItem.
 */
@Service
@RequiredArgsConstructor
public class OrderReservationService {
    public static final String REASON_CANCELLED = "ORDER_CANCELLED";
    public static final String REASON_EXPIRED = "RESERVATION_EXPIRED";
    public static final String NOT_AVAILABLE = "Requested product is not available on this machine";

    private final InventoryItemRepository items;
    private final MachineSlotRepository slots;
    private final InventoryTransactionRepository history;
    private final OrderItemAllocationRepository allocations;
    private final PaymentService payments;

    /**
     * Locks and returns the bowl the machine will physically drop next for this product: the sellable head of one slot.
     * Caller already holds Product (share) and Machine (share); this takes the candidate Slots FOR UPDATE in id order,
     * then the head InventoryItem FOR UPDATE. Bowls behind a head are never reservable, so at most one bowl per slot is RESERVED.
     */
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public InventoryItem selectHead(UUID machineId, UUID productId, Instant holdDeadline) {
        List<UUID> candidates = items.findSlotIdsHoldingProduct(machineId, productId);
        if (candidates.isEmpty()) throw new ConflictException(NOT_AVAILABLE);
        List<UUID> locked = slots.findAllForUpdateByIdInAndMachineId(candidates, machineId).stream().map(MachineSlot::getId).toList();
        if (locked.isEmpty()) throw new ConflictException(NOT_AVAILABLE);
        // Heads are recomputed under the slot locks: loading and removal take the same slot lock first.
        UUID headId = items.findSellableHeadId(machineId, productId, locked, holdDeadline).orElseThrow(() -> new ConflictException(NOT_AVAILABLE));
        InventoryItem head = items.findForUpdateById(headId).orElseThrow(() -> new ConflictException(NOT_AVAILABLE));
        if (head.getStatus() != InventoryStatus.AVAILABLE || !head.getBatch().getExpiresAt().isAfter(holdDeadline)) {
            throw new ConflictException(NOT_AVAILABLE);
        }
        return head;
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public void reserve(Order order, OrderItem line, InventoryItem bowl, Instant now) {
        bowl.setStatus(InventoryStatus.RESERVED);
        bowl.setReservedAt(now);
        var allocation = new OrderItemAllocation();
        allocation.setOrderItem(line);
        allocation.setInventoryItem(bowl);
        allocation.setStatus(AllocationStatus.RESERVED);
        allocations.save(allocation);
        append(bowl, order, InventoryTransactionType.RESERVE, null, InventoryStatus.AVAILABLE, InventoryStatus.RESERVED);
    }

    /** PENDING_PAYMENT to CANCELLED, returning every RESERVED bowl to AVAILABLE with RETURN history. */
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public void release(Order order, String reason, Instant now) {
        // created_at comes from the database clock; never let clock skew violate cancelled_at >= created_at.
        order.setStatus(OrderStatus.CANCELLED);
        order.setCancelledAt(notBefore(now, order.getCreatedAt()));
        // Lock order: Order (held by the caller), then Payment, then InventoryItem.
        payments.expirePendingPayments(order, reason);
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
