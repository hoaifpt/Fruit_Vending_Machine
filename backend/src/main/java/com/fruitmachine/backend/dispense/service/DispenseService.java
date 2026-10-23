package com.fruitmachine.backend.dispense.service;

import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.dispense.dto.*;
import com.fruitmachine.backend.dispense.entity.DispenseCommand;
import com.fruitmachine.backend.dispense.enums.DispenseStatus;
import com.fruitmachine.backend.dispense.repository.DispenseCommandRepository;
import com.fruitmachine.backend.inventory.entity.InventoryItem;
import com.fruitmachine.backend.inventory.entity.InventoryTransaction;
import com.fruitmachine.backend.inventory.enums.InventoryStatus;
import com.fruitmachine.backend.inventory.enums.InventoryTransactionType;
import com.fruitmachine.backend.inventory.repository.InventoryItemRepository;
import com.fruitmachine.backend.inventory.repository.InventoryTransactionRepository;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.machine.enums.SlotStatus;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.machine.repository.MachineSlotRepository;
import com.fruitmachine.backend.order.entity.Order;
import com.fruitmachine.backend.order.entity.OrderItemAllocation;
import com.fruitmachine.backend.order.enums.AllocationStatus;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.order.repository.OrderItemAllocationRepository;
import com.fruitmachine.backend.order.repository.OrderRepository;
import com.fruitmachine.backend.security.kiosk.AuthenticatedKiosk;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Order is the serialization lock for all command transitions. Claim additionally locks Machine
 * so two stations cannot use the shared IR sensor simultaneously. Never call hardware in a transaction. */
@Service
@RequiredArgsConstructor
@PreAuthorize("hasRole('KIOSK')")
@EnableConfigurationProperties(DispenseProperties.class)
public class DispenseService {
    public static final List<DispenseStatus> ACTIVE = List.of(DispenseStatus.SENT, DispenseStatus.ACKNOWLEDGED);
    private final DispenseCommandRepository commands;
    private final OrderRepository orders;
    private final OrderItemAllocationRepository allocations;
    private final InventoryItemRepository inventory;
    private final InventoryTransactionRepository history;
    private final MachineRepository machines;
    private final MachineSlotRepository slots;
    private final Clock clock;
    private final DispenseProperties properties;

    @Transactional
    public DispenseCommandResponse prepare(AuthenticatedKiosk kiosk, UUID orderId) {
        Order order = ownOrder(kiosk, orderId);
        var existing = commands.findByOrderIdAndMachineId(orderId, kiosk.machineId());
        if (existing.isPresent()) return DispenseCommandResponse.from(existing.get());
        require(order.getStatus() == OrderStatus.PAID, "Only a backend-confirmed PAID order can dispense");
        var allocation = singleAllocation(orderId);
        var bowl = inventory.findForUpdateById(allocation.getInventoryItem().getId()).orElseThrow(DispenseService::missing);
        require(bowl.getStatus() == InventoryStatus.RESERVED, "The reserved bowl is not available for fulfillment");
        require(bowl.getSlot() != null && bowl.getSlot().getMachine().getId().equals(kiosk.machineId()), "Invalid reserved location");
        require(bowl.getBatch().getExpiresAt().isAfter(clock.instant().plus(properties.timeout())), "Reserved bowl expires too soon; contact staff");
        var command = new DispenseCommand();
        command.setCommandCode("DSP-" + UUID.randomUUID());
        command.setOrderId(orderId);
        command.setMachineId(kiosk.machineId());
        command.setSlotId(bowl.getSlot().getId());
        command.setInventoryItemId(bowl.getId());
        commands.saveAndFlush(command);
        return DispenseCommandResponse.from(command);
    }

    @Transactional(readOnly = true)
    public DispenseCommandResponse get(AuthenticatedKiosk kiosk, UUID orderId) {
        return DispenseCommandResponse.from(commands.findByOrderIdAndMachineId(orderId, kiosk.machineId()).orElseThrow(DispenseService::missing));
    }

    @Transactional(readOnly = true)
    public List<DispenseCommandResponse> pending(AuthenticatedKiosk kiosk) {
        return commands.findByMachineIdAndStatusOrderByCreatedAtAscIdAsc(kiosk.machineId(), DispenseStatus.PENDING, PageRequest.of(0, 20))
                .stream().map(DispenseCommandResponse::from).toList();
    }

    @Transactional
    public DispenseClaimResponse claim(AuthenticatedKiosk kiosk, UUID commandId) {
        UUID orderId = commands.findOrderId(commandId, kiosk.machineId()).orElseThrow(DispenseService::missing);
        Order order = ownOrder(kiosk, orderId);
        var machine = machines.findForUpdateById(kiosk.machineId()).orElseThrow(DispenseService::missing);
        var command = commands.findByIdAndMachineId(commandId, kiosk.machineId()).orElseThrow(DispenseService::missing);
        require(command.getStatus() == DispenseStatus.PENDING, "Command already claimed; never resend hardware motion");
        require(order.getStatus() == OrderStatus.PAID, "Order is not PAID");
        require(machine.getStatus() == MachineStatus.ACTIVE, "Machine is not accepting dispense commands");
        require(!commands.existsByMachineIdAndStatusIn(machine.getId(), ACTIVE), "Another command is using this machine");
        var slot = slots.findForUpdateByIdAndMachineId(command.getSlotId(), machine.getId()).orElseThrow(DispenseService::missing);
        require(slot.getStatus() == SlotStatus.ACTIVE, "Assigned slot is not ACTIVE");
        var allocation = singleAllocation(orderId);
        require(allocation.getInventoryItem().getId().equals(command.getInventoryItemId()), "Allocation does not match command");
        var bowl = inventory.findForUpdateById(command.getInventoryItemId()).orElseThrow(DispenseService::missing);
        require(bowl.getStatus() == InventoryStatus.RESERVED && bowl.getBatch().getExpiresAt().isAfter(clock.instant().plus(properties.timeout())), "Bowl is unavailable or expires too soon");
        command.setDispatchToken(UUID.randomUUID());
        command.setStatus(DispenseStatus.SENT);
        command.setSentAt(nowNotBefore(command.getCreatedAt()));
        order.setStatus(OrderStatus.DISPENSING);
        commands.flush();
        return new DispenseClaimResponse(DispenseCommandResponse.from(command), command.getDispatchToken());
    }

    @Transactional
    public DispenseCommandResponse result(AuthenticatedKiosk kiosk, UUID commandId, DispenseResultRequest request) {
        UUID orderId = commands.findOrderId(commandId, kiosk.machineId()).orElseThrow(DispenseService::missing);
        Order order = ownOrder(kiosk, orderId);
        var command = commands.findByIdAndMachineId(commandId, kiosk.machineId()).orElseThrow(DispenseService::missing);
        require(command.getDispatchToken() != null && command.getDispatchToken().equals(request.dispatchToken()), "Invalid dispatch claim");
        DispenseStatus target = DispenseStatus.valueOf(request.status().name());
        if (command.getStatus() == target) {
            require(target == DispenseStatus.ACKNOWLEDGED || Objects.equals(command.getBowlCountBefore(), request.bowlCountBefore())
                    && Objects.equals(command.getBowlCountAfter(), request.bowlCountAfter()), "Conflicting terminal evidence");
            return DispenseCommandResponse.from(command);
        }
        require(ACTIVE.contains(command.getStatus()), "Command is terminal or was never claimed");
        require(order.getStatus() == OrderStatus.DISPENSING, "Order is not dispensing");
        if (target == DispenseStatus.ACKNOWLEDGED) {
            command.setStatus(target);
            command.setAcknowledgedAt(nowNotBefore(command.getSentAt()));
        } else {
            if (target == DispenseStatus.SUCCESS) {
                require(request.bowlCountBefore() != null && request.bowlCountAfter() != null
                        && request.bowlCountAfter() - request.bowlCountBefore() == 1, "SUCCESS requires exactly one observed bowl");
            }
            finish(order, command, target, request.bowlCountBefore(), request.bowlCountAfter());
        }
        commands.flush();
        return DispenseCommandResponse.from(command);
    }

    // Called from a trusted scheduler, never exposed as a user-authorized state mutation.
    @Transactional
    @PreAuthorize("permitAll()")
    public void expire(UUID id, Instant deadline) {
        var orderId = commands.findOrderId(id).orElse(null);
        if (orderId == null) return;
        Order order = orders.findForUpdateById(orderId).orElseThrow(DispenseService::missing);
        var command = commands.findById(id).orElseThrow(DispenseService::missing);
        Instant started = command.getSentAt() == null ? command.getCreatedAt() : command.getSentAt();
        if ((ACTIVE.contains(command.getStatus()) || command.getStatus() == DispenseStatus.PENDING) && started.isBefore(deadline)) {
            finish(order, command, DispenseStatus.TIMEOUT, null, null);
        }
    }

    private void finish(Order order, DispenseCommand command, DispenseStatus status, Long before, Long after) {
        // Machine precedes InventoryItem consistently with claim/loading; no hardware I/O here.
        var machine = machines.findForUpdateById(command.getMachineId()).orElseThrow(DispenseService::missing);
        var allocation = singleAllocation(order.getId());
        var bowl = inventory.findForUpdateById(command.getInventoryItemId()).orElseThrow(DispenseService::missing);
        require(allocation.getInventoryItem().getId().equals(bowl.getId()) && bowl.getStatus() == InventoryStatus.RESERVED,
                "Reserved allocation no longer matches command");
        boolean success = status == DispenseStatus.SUCCESS;
        require(!success || bowl.getBatch().getExpiresAt().isAfter(clock.instant()), "Expired bowl requires reconciliation");
        command.setStatus(status);
        if (command.getSentAt() != null) command.setCompletedAt(nowNotBefore(command.getAcknowledgedAt() == null ? command.getSentAt() : command.getAcknowledgedAt()));
        command.setBowlCountBefore(before);
        command.setBowlCountAfter(after);
        bowl.setStatus(success ? InventoryStatus.SOLD : InventoryStatus.DISPENSE_FAILED);
        order.setStatus(success ? OrderStatus.COMPLETED : OrderStatus.DISPENSE_FAILED);
        if (success) {
            allocation.setStatus(AllocationStatus.DISPENSED);
            bowl.setSoldAt(nowNotBefore(bowl.getReservedAt()));
            order.setCompletedAt(nowNotBefore(order.getPaidAt()));
        } else {
            // An unknown physical result is never returned to saleable stock or retried automatically.
            machine.setStatus(MachineStatus.MAINTENANCE);
        }
        var event = new InventoryTransaction();
        event.setInventoryItem(bowl);
        event.setMachineId(command.getMachineId());
        event.setSlotId(command.getSlotId());
        event.setType(success ? InventoryTransactionType.SALE : InventoryTransactionType.ADJUSTMENT);
        event.setReferenceId(command.getId());
        event.setReason(success ? "DISPENSE_SUCCESS" : "DISPENSE_" + status.name());
        event.setStatusBefore(InventoryStatus.RESERVED);
        event.setStatusAfter(bowl.getStatus());
        history.saveAndFlush(event);
    }

    private Order ownOrder(AuthenticatedKiosk kiosk, UUID id) {
        return orders.findForUpdateByIdAndMachineId(id, kiosk.machineId()).orElseThrow(DispenseService::missing);
    }

    private OrderItemAllocation singleAllocation(UUID orderId) {
        var rows = allocations.findByOrderIdAndStatus(orderId, AllocationStatus.RESERVED);
        require(rows.size() == 1 && rows.getFirst().getOrderItem().getQuantity() == 1, "Exactly one reserved bowl is required");
        return rows.getFirst();
    }

    private Instant nowNotBefore(Instant floor) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        return floor != null && now.isBefore(floor) ? floor : now;
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new ConflictException(message);
    }

    private static ResourceNotFoundException missing() { return new ResourceNotFoundException("Dispense command not found"); }
}
