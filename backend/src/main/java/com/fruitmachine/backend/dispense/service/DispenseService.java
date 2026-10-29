package com.fruitmachine.backend.dispense.service;

import com.fruitmachine.backend.config.properties.DispenseProperties;
import com.fruitmachine.backend.dispense.entity.DispenseCommand;
import com.fruitmachine.backend.dispense.enums.DispenseStatus;
import com.fruitmachine.backend.dispense.repository.DispenseCommandRepository;
import com.fruitmachine.backend.inventory.entity.InventoryItem;
import com.fruitmachine.backend.inventory.entity.InventoryTransaction;
import com.fruitmachine.backend.inventory.enums.InventoryStatus;
import com.fruitmachine.backend.inventory.enums.InventoryTransactionType;
import com.fruitmachine.backend.inventory.repository.InventoryItemRepository;
import com.fruitmachine.backend.inventory.repository.InventoryTransactionRepository;
import com.fruitmachine.backend.order.entity.Order;
import com.fruitmachine.backend.order.entity.OrderItemAllocation;
import com.fruitmachine.backend.order.enums.AllocationStatus;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.order.repository.OrderItemAllocationRepository;
import com.fruitmachine.backend.order.repository.OrderRepository;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.EnumSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Dispense command lifecycle (docs/mqtt-dispense.md). The backend creates one command per paid bowl, delivers it at least once
 * through {@link MachineCommandGateway} and applies the machine's reports idempotently:
 * PENDING -> SENT -> ACKNOWLEDGED -> SUCCESS | FAILED | TIMEOUT. Lock order: Order, DispenseCommand, InventoryItem, as in payments.
 * The machine never decides that an order is paid: commands exist only for orders the payment webhook turned PAID.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@EnableConfigurationProperties(DispenseProperties.class)
public class DispenseService {
    public static final String EVENT_ACCEPTED = "DISPENSE_ACCEPTED";
    public static final String EVENT_REJECTED = "DISPENSE_REJECTED";
    public static final String EVENT_COMPLETED = "DISPENSE_COMPLETED";
    public static final String EVENT_ABORTED = "DISPENSE_ABORTED";
    static final String REASON_ABORTED = "DISPENSE_ABORTED";
    static final String REASON_TIMEOUT = "DISPENSE_TIMEOUT";
    private static final Set<DispenseStatus> OPEN = EnumSet.of(DispenseStatus.PENDING, DispenseStatus.SENT, DispenseStatus.ACKNOWLEDGED);
    private static final Set<DispenseStatus> RESENDABLE = EnumSet.of(DispenseStatus.PENDING, DispenseStatus.SENT);
    private static final SecureRandom RANDOM = new SecureRandom();

    public enum Outcome { APPLIED, DUPLICATE, IGNORED, UNKNOWN_COMMAND, WRONG_MACHINE }

    private final DispenseCommandRepository commands;
    private final OrderRepository orders;
    private final OrderItemAllocationRepository allocations;
    private final InventoryItemRepository items;
    private final InventoryTransactionRepository history;
    private final MachineCommandGateway gateway;
    private final ApplicationEventPublisher events;
    private final DispenseProperties properties;
    private final Clock clock;
    /** Last delivery attempt per open command, so the sweep re-sends only after resend-after (single backend instance). */
    private final Map<UUID, Instant> lastAttempt = new ConcurrentHashMap<>();

    /** Called by the payment confirmation for an order that just became PAID; the caller holds the Order lock. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void createForPaidOrder(Order order) {
        if (commands.existsByOrderId(order.getId())) return;
        for (OrderItemAllocation allocation : allocations.findByOrderIdAndStatus(order.getId(), AllocationStatus.RESERVED)) {
            InventoryItem bowl = allocation.getInventoryItem();
            var command = new DispenseCommand();
            command.setCommandCode(newCode());
            command.setOrderId(order.getId());
            command.setMachineId(order.getMachineId());
            command.setSlotId(bowl.getSlotId());
            command.setInventoryItemId(bowl.getId());
            commands.save(command);
            events.publishEvent(new DispenseRequestedEvent(command.getId()));
        }
        commands.flush();
    }

    /** Hands an open command to the machine. Repeats are safe: the same command code never dispenses twice. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void send(UUID commandId) {
        UUID orderId = commands.findOrderIdById(commandId).orElse(null);
        if (orderId == null) return;
        Order order = orders.findForUpdateById(orderId).orElseThrow();
        DispenseCommand command = commands.findForUpdateById(commandId).orElseThrow();
        if (!RESENDABLE.contains(command.getStatus())) return;
        Instant now = now();
        lastAttempt.put(commandId, now);
        if (!gateway.sendDispense(command.getMachine().getCode(), command.getCommandCode())) {
            log.debug("Dispense command {} not delivered: machine transport unavailable", command.getCommandCode());
            return;
        }
        markSent(command, now);
        if (order.getStatus() == OrderStatus.PAID) order.setStatus(OrderStatus.DISPENSING);
    }

    /** Applies a machine report. Unknown codes, other machines' codes and repeats change nothing. */
    @Transactional
    public Outcome handleMachineEvent(String machineCode, String eventType, String commandCode) {
        UUID commandId = commandCode == null ? null : commands.findIdByCommandCode(commandCode).orElse(null);
        if (commandId == null) return Outcome.UNKNOWN_COMMAND;
        Order order = orders.findForUpdateById(commands.findOrderIdById(commandId).orElseThrow()).orElseThrow();
        DispenseCommand command = commands.findForUpdateById(commandId).orElseThrow();
        if (!command.getMachine().getCode().equals(machineCode)) {
            log.warn("Machine {} reported {} for command {} of another machine; ignored", machineCode, eventType, commandCode);
            return Outcome.WRONG_MACHINE;
        }
        Instant now = now();
        return switch (eventType) {
            case EVENT_ACCEPTED -> accepted(command, order, now);
            case EVENT_COMPLETED -> completed(command, order, now);
            case EVENT_ABORTED -> {
                if (!OPEN.contains(command.getStatus())) yield command.getStatus() == DispenseStatus.SUCCESS ? Outcome.IGNORED : Outcome.DUPLICATE;
                fail(command, order, now, DispenseStatus.FAILED, REASON_ABORTED);
                yield Outcome.APPLIED;
            }
            // BUSY: the command stays open and the sweep re-sends it.
            case EVENT_REJECTED -> Outcome.IGNORED;
            default -> Outcome.IGNORED;
        };
    }

    /** Sweep step for one open command: time it out, or re-send it when the last attempt is old enough. */
    @Transactional
    public void expireOrResend(UUID commandId) {
        UUID orderId = commands.findOrderIdById(commandId).orElse(null);
        if (orderId == null) return;
        Order order = orders.findForUpdateById(orderId).orElseThrow();
        DispenseCommand command = commands.findForUpdateById(commandId).orElseThrow();
        if (!OPEN.contains(command.getStatus())) {
            lastAttempt.remove(commandId);
            return;
        }
        Instant now = now();
        if (!command.getCreatedAt().plus(properties.timeout()).isAfter(now)) {
            fail(command, order, now, DispenseStatus.TIMEOUT, REASON_TIMEOUT);
            return;
        }
        Instant last = lastAttempt.get(commandId);
        if (RESENDABLE.contains(command.getStatus()) && (last == null || !last.plus(properties.resendAfter()).isAfter(now))) {
            lastAttempt.put(commandId, now);
            if (gateway.sendDispense(command.getMachine().getCode(), command.getCommandCode())) {
                markSent(command, now);
                if (order.getStatus() == OrderStatus.PAID) order.setStatus(OrderStatus.DISPENSING);
            }
        }
    }

    @Transactional(readOnly = true)
    public List<UUID> openCommandIds(int limit) {
        return commands.findIdsByStatusIn(OPEN, PageRequest.of(0, limit));
    }

    private Outcome accepted(DispenseCommand command, Order order, Instant now) {
        if (!RESENDABLE.contains(command.getStatus())) return Outcome.DUPLICATE;
        markSent(command, now);
        command.setStatus(DispenseStatus.ACKNOWLEDGED);
        command.setAcknowledgedAt(notBefore(now, command.getSentAt()));
        if (order.getStatus() == OrderStatus.PAID) order.setStatus(OrderStatus.DISPENSING);
        return Outcome.APPLIED;
    }

    /** The machine is the witness of the physical drop, so a late success also corrects an earlier FAILED or TIMEOUT. */
    private Outcome completed(DispenseCommand command, Order order, Instant now) {
        if (command.getStatus() == DispenseStatus.SUCCESS) return Outcome.DUPLICATE;
        markSent(command, now);
        command.setStatus(DispenseStatus.SUCCESS);
        command.setCompletedAt(notBefore(now, command.getSentAt()));
        lastAttempt.remove(command.getId());

        InventoryItem bowl = items.findForUpdateById(command.getInventoryItemId()).orElseThrow();
        InventoryStatus before = bowl.getStatus();
        bowl.setStatus(InventoryStatus.SOLD);
        bowl.setSoldAt(notBefore(now, bowl.getLoadedAt()));
        append(bowl, order, InventoryTransactionType.SALE, null, before, InventoryStatus.SOLD);
        for (OrderItemAllocation allocation : allocations.findByOrderIdAndStatus(order.getId(), AllocationStatus.RESERVED)) {
            if (allocation.getInventoryItem().getId().equals(bowl.getId())) allocation.setStatus(AllocationStatus.DISPENSED);
        }
        order.setStatus(OrderStatus.COMPLETED);
        order.setCompletedAt(notBefore(now, order.getPaidAt()));
        flush();
        return Outcome.APPLIED;
    }

    /** FAILED or TIMEOUT: the bowl becomes DISPENSE_FAILED (it blocks its column) and the order waits for staff. */
    private void fail(DispenseCommand command, Order order, Instant now, DispenseStatus status, String reason) {
        command.setStatus(status);
        if (command.getSentAt() != null) command.setCompletedAt(notBefore(now, command.getSentAt()));
        lastAttempt.remove(command.getId());
        InventoryItem bowl = items.findForUpdateById(command.getInventoryItemId()).orElseThrow();
        if (bowl.getStatus() == InventoryStatus.RESERVED) {
            bowl.setStatus(InventoryStatus.DISPENSE_FAILED);
            append(bowl, order, InventoryTransactionType.ADJUSTMENT, reason, InventoryStatus.RESERVED, InventoryStatus.DISPENSE_FAILED);
        }
        if (order.getStatus() == OrderStatus.PAID || order.getStatus() == OrderStatus.DISPENSING) order.setStatus(OrderStatus.DISPENSE_FAILED);
        log.warn("Dispense command {} of order {} ended {}", command.getCommandCode(), order.getOrderCode(), status);
        flush();
    }

    private void markSent(DispenseCommand command, Instant now) {
        if (command.getStatus() != DispenseStatus.PENDING) return;
        command.setStatus(DispenseStatus.SENT);
        command.setSentAt(notBefore(now, command.getCreatedAt()));
    }

    private void append(InventoryItem bowl, Order order, InventoryTransactionType type, String reason, InventoryStatus before, InventoryStatus after) {
        var event = new InventoryTransaction();
        event.setInventoryItem(bowl);
        // The machine is not a user, so performedBy stays NULL.
        event.setMachineId(order.getMachineId());
        event.setSlotId(bowl.getSlotId());
        event.setType(type);
        event.setReferenceId(order.getId());
        event.setReason(reason);
        event.setStatusBefore(before);
        event.setStatusAfter(after);
        history.save(event);
    }

    private void flush() {
        orders.flush();
        commands.flush();
        items.flush();
        history.flush();
    }

    private String newCode() {
        // Firmware limit: 1-39 characters of [A-Za-z0-9_-].
        String code;
        do {
            byte[] bytes = new byte[8];
            RANDOM.nextBytes(bytes);
            code = "D-" + HexFormat.of().withUpperCase().formatHex(bytes);
        } while (commands.existsByCommandCode(code));
        return code;
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }

    private static Instant notBefore(Instant candidate, Instant floor) {
        return floor != null && candidate.isBefore(floor) ? floor : candidate;
    }
}
