package com.fruitmachine.backend.dispense.service;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fruitmachine.backend.audit.entity.AuditLog;
import com.fruitmachine.backend.audit.repository.AuditLogRepository;
import com.fruitmachine.backend.config.properties.DispenseProperties;
import com.fruitmachine.backend.dispense.entity.DispenseCommand;
import com.fruitmachine.backend.dispense.enums.DispenseStatus;
import com.fruitmachine.backend.dispense.event.DispenseFailedEvent;
import com.fruitmachine.backend.dispense.event.DispenseLateSuccessEvent;
import com.fruitmachine.backend.dispense.event.DispenseMultipleBowlsEvent;
import com.fruitmachine.backend.dispense.repository.CommandRoute;
import com.fruitmachine.backend.dispense.repository.DispenseCommandRepository;
import com.fruitmachine.backend.inventory.entity.InventoryItem;
import com.fruitmachine.backend.inventory.entity.InventoryTransaction;
import com.fruitmachine.backend.inventory.enums.InventoryStatus;
import com.fruitmachine.backend.inventory.enums.InventoryTransactionType;
import com.fruitmachine.backend.inventory.repository.InventoryItemRepository;
import com.fruitmachine.backend.inventory.repository.InventoryTransactionRepository;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.machine.entity.MachineSlot;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.machine.enums.SlotStatus;
import com.fruitmachine.backend.machine.repository.MachineCommandLockRepository;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.machine.service.MachineService;
import com.fruitmachine.backend.mqtt.contract.MachineErrorCode;
import com.fruitmachine.backend.mqtt.contract.MachineEventType;
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
 * Dispense command lifecycle (docs/mqtt-dispense.md, api-contract/mqtt-contract.md). The backend creates one command per paid
 * bowl, publishes it through {@link MachineCommandGateway} and applies the machine's reports idempotently:
 * PENDING -> SENT -> ACKNOWLEDGED -> SUCCESS | FAILED | TIMEOUT.
 *
 * <p>A command is published only while its machine and slot are ACTIVE and no other command of the machine is in flight
 * (the firmware runs one command at a time). A failure is either <em>safe</em> (the machine certainly did not move: the bowl
 * becomes AVAILABLE again) or <em>unsafe</em> (the outcome is unknown: the bowl becomes DISPENSE_FAILED and the machine goes to
 * MAINTENANCE). Every FAILED/TIMEOUT command stores a {@link DispenseFailureReason}.
 *
 * <p>Lock order: machine command advisory lock, Machine row (only where its status is read for publishing or may change),
 * Order, DispenseCommand, InventoryItem. The machine never decides that an order is paid: commands exist only for orders the
 * payment webhook turned PAID.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@EnableConfigurationProperties(DispenseProperties.class)
public class DispenseService {
    public static final String EVENT_ACCEPTED = MachineEventType.DISPENSE_ACCEPTED;
    public static final String EVENT_REJECTED = MachineEventType.DISPENSE_REJECTED;
    public static final String EVENT_COMPLETED = MachineEventType.DISPENSE_COMPLETED;
    public static final String EVENT_ABORTED = MachineEventType.DISPENSE_ABORTED;
    /** audit_logs action: the machine reported success for a command whose order had been refunded meanwhile. */
    public static final String AUDIT_SUCCESS_AFTER_REFUND = "DISPENSE_SUCCESS_AFTER_REFUND";
    /** audit_logs action: a late success could not be applied (the bowl was returned, removed or resold meanwhile). */
    public static final String AUDIT_LATE_RESULT_CONFLICT = "DISPENSE_LATE_RESULT_CONFLICT";
    static final String MAINTENANCE_MULTIPLE_BOWLS = MachineErrorCode.Reason.MULTIPLE_BOWLS_DETECTED.name();
    private static final Set<String> EVENTS = Set.of(EVENT_ACCEPTED, EVENT_REJECTED, EVENT_COMPLETED, EVENT_ABORTED);
    private static final Set<DispenseStatus> OPEN = EnumSet.of(DispenseStatus.PENDING, DispenseStatus.SENT, DispenseStatus.ACKNOWLEDGED);
    private static final Set<DispenseStatus> RESENDABLE = EnumSet.of(DispenseStatus.PENDING, DispenseStatus.SENT);
    /** Published and without a result: the machine may be running it. */
    private static final Set<DispenseStatus> IN_FLIGHT = EnumSet.of(DispenseStatus.SENT, DispenseStatus.ACKNOWLEDGED);
    private static final SecureRandom RANDOM = new SecureRandom();

    public enum Outcome { APPLIED, DUPLICATE, IGNORED, UNKNOWN_COMMAND, WRONG_MACHINE }

    private final DispenseCommandRepository commands;
    private final OrderRepository orders;
    private final OrderItemAllocationRepository allocations;
    private final InventoryItemRepository items;
    private final InventoryTransactionRepository history;
    private final MachineRepository machines;
    private final MachineCommandLockRepository machineLock;
    private final MachineService machineService;
    private final AuditLogRepository audits;
    private final MachineCommandGateway gateway;
    private final ApplicationEventPublisher events;
    private final DispenseProperties properties;
    private final Clock clock;
    /** Last delivery attempt per open command, so the sweep re-sends only after resend-after (single backend instance). */
    private final Map<UUID, Instant> lastAttempt = new ConcurrentHashMap<>();

    /** Called by the payment confirmation for an order that just became PAID; the caller holds the Order lock. Never publishes. */
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

    /**
     * First delivery, right after the payment commit. When another transaction is working on this machine's commands the
     * delivery is skipped instead of queued behind it: the sweep publishes the command as soon as the machine is free.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void send(UUID commandId) {
        CommandRoute route = commands.findRouteById(commandId).orElse(null);
        if (route == null || !RESENDABLE.contains(route.status())) return;
        if (!machineLock.tryAcquire(route.machineId())) {
            log.debug("Dispense command {} waits for the sweep: machine {} is busy", commandId, route.machineCode());
            return;
        }
        Machine machine = machines.findForShareById(route.machineId()).orElseThrow();
        Order order = orders.findForUpdateById(route.orderId()).orElseThrow();
        DispenseCommand command = commands.findForUpdateById(commandId).orElseThrow();
        if (!RESENDABLE.contains(command.getStatus())) return;
        publish(command, order, machine, now());
    }

    /** A report without optional details, as firmware v0.3.0 sends it. */
    @Transactional
    public Outcome handleMachineEvent(String machineCode, String eventType, String commandCode) {
        return handleMachineEvent(machineCode, DispenseReport.of(eventType, commandCode));
    }

    /** Applies a machine report. Unknown codes, other machines' codes and repeats change nothing. */
    @Transactional
    public Outcome handleMachineEvent(String machineCode, DispenseReport report) {
        CommandRoute route = report.commandCode() == null ? null : commands.findRouteByCommandCode(report.commandCode()).orElse(null);
        if (route == null) return Outcome.UNKNOWN_COMMAND;
        if (!route.machineCode().equals(machineCode)) {
            log.warn("Machine {} reported {} for command {} of another machine; ignored", machineCode, report.eventType(), report.commandCode());
            return Outcome.WRONG_MACHINE;
        }
        if (report.eventType() == null || !EVENTS.contains(report.eventType())) return Outcome.IGNORED;
        machineLock.acquire(route.machineId());
        // Machine before Order and InventoryItem: reports that may put the machine in MAINTENANCE take its row lock now.
        if (mayChangeMachine(report)) machines.findForUpdateById(route.machineId()).orElseThrow();
        Order order = orders.findForUpdateById(route.orderId()).orElseThrow();
        DispenseCommand command = commands.findForUpdateById(route.id()).orElseThrow();
        Instant now = now();
        return switch (report.eventType()) {
            case EVENT_ACCEPTED -> accepted(command, order, now);
            case EVENT_COMPLETED -> completed(command, order, report, now);
            case EVENT_ABORTED -> aborted(command, order, report, now);
            default -> rejected(command, order, report, now);
        };
    }

    /** Sweep step for one open command: time it out, or publish / re-send it when allowed. */
    @Transactional
    public void expireOrResend(UUID commandId) {
        CommandRoute route = commands.findRouteById(commandId).orElse(null);
        if (route == null) return;
        if (!OPEN.contains(route.status())) {
            lastAttempt.remove(commandId);
            return;
        }
        // A result timeout puts the machine in MAINTENANCE, so that path needs the Machine row for update before the Order.
        boolean resultTimeoutExpected = resultTimeoutDue(route.status(), route.sentAt(), now());
        machineLock.acquire(route.machineId());
        Machine machine = (resultTimeoutExpected ? machines.findForUpdateById(route.machineId()) : machines.findForShareById(route.machineId())).orElseThrow();
        Order order = orders.findForUpdateById(route.orderId()).orElseThrow();
        DispenseCommand command = commands.findForUpdateById(commandId).orElseThrow();
        if (!OPEN.contains(command.getStatus())) {
            lastAttempt.remove(commandId);
            return;
        }
        Instant now = now();
        if (IN_FLIGHT.contains(command.getStatus())) {
            if (resultTimeoutDue(command.getStatus(), command.getSentAt(), now)) {
                // Became due while waiting for the locks: the next sweep takes the Machine row lock first.
                if (!resultTimeoutExpected) return;
                failUnsafe(command, order, now, DispenseStatus.TIMEOUT, DispenseFailureReason.RESULT_TIMEOUT);
                return;
            }
        } else if (!command.getCreatedAt().plus(properties.pendingTimeout()).isAfter(now)) {
            failSafe(command, order, now, DispenseFailureReason.NOT_DELIVERED);
            return;
        }
        Instant last = lastAttempt.get(commandId);
        if (RESENDABLE.contains(command.getStatus()) && (last == null || !last.plus(properties.resendAfter()).isAfter(now))) {
            publish(command, order, machine, now);
        }
    }

    @Transactional(readOnly = true)
    public List<UUID> openCommandIds(int limit) {
        return commands.findIdsByStatusIn(OPEN, PageRequest.of(0, limit));
    }

    /**
     * Publishes the command when the machine can run it now. A command that has to wait stays as it is and is not counted as a
     * delivery attempt, so the sweep tries again at its next run. The caller holds the machine command lock.
     */
    private void publish(DispenseCommand command, Order order, Machine machine, Instant now) {
        MachineSlot slot = command.getSlot();
        if (machine.getStatus() != MachineStatus.ACTIVE || slot.getStatus() != SlotStatus.ACTIVE) {
            log.debug("Dispense command {} waits: machine {} is {}, slot {} is {}", command.getCommandCode(), machine.getCode(),
                    machine.getStatus(), slot.getSlotCode(), slot.getStatus());
            return;
        }
        if (commands.existsOtherByMachineIdAndStatusIn(machine.getId(), IN_FLIGHT, command.getId())) {
            log.debug("Dispense command {} waits: machine {} is running another command", command.getCommandCode(), machine.getCode());
            return;
        }
        lastAttempt.put(command.getId(), now);
        if (!gateway.sendDispense(machine.getCode(), command.getCommandCode(), slot.getSlotCode())) {
            log.debug("Dispense command {} not delivered: machine transport unavailable", command.getCommandCode());
            return;
        }
        markSent(command, now);
        if (order.getStatus() == OrderStatus.PAID) order.setStatus(OrderStatus.DISPENSING);
    }

    private Outcome accepted(DispenseCommand command, Order order, Instant now) {
        if (!RESENDABLE.contains(command.getStatus())) return Outcome.DUPLICATE;
        markSent(command, now);
        command.setStatus(DispenseStatus.ACKNOWLEDGED);
        command.setAcknowledgedAt(notBefore(now, command.getSentAt()));
        if (order.getStatus() == OrderStatus.PAID) order.setStatus(OrderStatus.DISPENSING);
        return Outcome.APPLIED;
    }

    /**
     * The machine is the witness of the physical drop. On time: the bowl is sold and the order completed. After the command
     * had failed or timed out, only a bowl that is still blocked (DISPENSE_FAILED) can be corrected: a failed order is completed,
     * a refunded order stays refunded and is flagged for an administrator. Anything else is recorded and changes nothing.
     */
    private Outcome completed(DispenseCommand command, Order order, DispenseReport report, Instant now) {
        if (command.getStatus() == DispenseStatus.SUCCESS) return Outcome.DUPLICATE;
        boolean late = !OPEN.contains(command.getStatus());
        InventoryItem bowl = items.findForUpdateById(command.getInventoryItemId()).orElseThrow();
        if (late && (bowl.getStatus() != InventoryStatus.DISPENSE_FAILED
                || (order.getStatus() != OrderStatus.DISPENSE_FAILED && order.getStatus() != OrderStatus.REFUNDED))) {
            if (!audits.existsByActionAndEntityId(AUDIT_LATE_RESULT_CONFLICT, command.getId())) audit(AUDIT_LATE_RESULT_CONFLICT, command, order, bowl);
            log.warn("Late success for dispense command {} not applied: command {}, bowl {}, order {}", command.getCommandCode(),
                    command.getStatus(), bowl.getStatus(), order.getStatus());
            flush();
            return Outcome.IGNORED;
        }
        boolean refunded = order.getStatus() == OrderStatus.REFUNDED;
        // Before the bowl changes, so the audit row shows what the success was applied to.
        if (refunded) audit(AUDIT_SUCCESS_AFTER_REFUND, command, order, bowl);

        if (command.getSentAt() == null) command.setSentAt(notBefore(now, command.getCreatedAt()));
        command.setStatus(DispenseStatus.SUCCESS);
        command.setFailureReason(null);
        command.setCompletedAt(notBefore(now, command.getSentAt()));
        lastAttempt.remove(command.getId());

        InventoryStatus before = bowl.getStatus();
        bowl.setStatus(InventoryStatus.SOLD);
        bowl.setSoldAt(notBefore(now, bowl.getLoadedAt()));
        append(bowl, order, InventoryTransactionType.SALE, null, before, InventoryStatus.SOLD);
        for (OrderItemAllocation allocation : allocations.findByOrderIdAndStatus(order.getId(), AllocationStatus.RESERVED)) {
            if (allocation.getInventoryItem().getId().equals(bowl.getId())) allocation.setStatus(AllocationStatus.DISPENSED);
        }
        if (!refunded) {
            order.setStatus(OrderStatus.COMPLETED);
            order.setCompletedAt(notBefore(now, order.getPaidAt()));
        }
        if (late && !refunded) events.publishEvent(new DispenseLateSuccessEvent(command.getId(), command.getCommandCode(),
                command.getMachineId(), command.getSlotId(), order.getId()));
        if (report.severalBowls()) {
            // The customer got the ordered bowl; which other bowls fell is unknown, so staff reconciles the column.
            machineService.enterMaintenanceBySystem(command.getMachineId(), MAINTENANCE_MULTIPLE_BOWLS);
            events.publishEvent(new DispenseMultipleBowlsEvent(command.getId(), command.getCommandCode(), command.getMachineId(),
                    command.getSlotId(), order.getId(), report.bowlCount()));
        }
        flush();
        return Outcome.APPLIED;
    }

    /** The cycle stopped after it may have started: the outcome is unknown whatever the reason. */
    private Outcome aborted(DispenseCommand command, Order order, DispenseReport report, Instant now) {
        if (!OPEN.contains(command.getStatus())) return command.getStatus() == DispenseStatus.SUCCESS ? Outcome.IGNORED : Outcome.DUPLICATE;
        failUnsafe(command, order, now, DispenseStatus.FAILED, DispenseFailureReason.ofAborted(report.reason()));
        return Outcome.APPLIED;
    }

    /**
     * BUSY, no reason (firmware v0.3.0) or an unknown reason: the command stays open and the sweep re-sends it. A reason that
     * says the command was not started ends it safely, unless the machine had already accepted this command: then "not started"
     * contradicts the earlier report and the outcome is treated as unknown.
     */
    private Outcome rejected(DispenseCommand command, Order order, DispenseReport report, Instant now) {
        if (!OPEN.contains(command.getStatus())) return Outcome.IGNORED;
        String reason = report.reason();
        if (reason == null || !DispenseFailureReason.NOT_EXECUTED.contains(reason)) return Outcome.IGNORED;
        if (command.getStatus() == DispenseStatus.ACKNOWLEDGED) {
            failUnsafe(command, order, now, DispenseStatus.FAILED, reason);
        } else {
            failSafe(command, order, now, reason);
            if (DispenseFailureReason.CONTROLLER_FAULT.equals(reason)) {
                machineService.enterMaintenanceBySystem(command.getMachineId(), reason);
            } else {
                log.error("Machine {} rejected dispense command {} as {}: the backend sent a command this firmware cannot run",
                        command.getMachine().getCode(), command.getCommandCode(), reason);
            }
            flush();
        }
        return Outcome.APPLIED;
    }

    /** Nothing moved: the bowl is AVAILABLE again (still the head of its slot) and the paid order waits for a refund. */
    private void failSafe(DispenseCommand command, Order order, Instant now, String reason) {
        close(command, now, DispenseStatus.FAILED, reason);
        InventoryItem bowl = items.findForUpdateById(command.getInventoryItemId()).orElseThrow();
        if (bowl.getStatus() == InventoryStatus.RESERVED) {
            bowl.setStatus(InventoryStatus.AVAILABLE);
            bowl.setReservedAt(null);
            append(bowl, order, InventoryTransactionType.RETURN, reason, InventoryStatus.RESERVED, InventoryStatus.AVAILABLE);
        }
        for (OrderItemAllocation allocation : allocations.findByOrderIdAndStatus(order.getId(), AllocationStatus.RESERVED)) {
            if (!allocation.getInventoryItem().getId().equals(bowl.getId())) continue;
            allocation.setStatus(AllocationStatus.RELEASED);
            allocation.setReleasedAt(notBefore(now, allocation.getCreatedAt()));
        }
        failOrder(order);
        events.publishEvent(new DispenseFailedEvent(command.getId(), command.getCommandCode(), command.getMachineId(), command.getSlotId(),
                order.getId(), reason, true));
        flush();
    }

    /**
     * The machine may have moved: the bowl becomes DISPENSE_FAILED (it blocks its column until staff checks it), the machine
     * stops selling, and the command is never sent again. The caller holds the Machine row lock.
     */
    private void failUnsafe(DispenseCommand command, Order order, Instant now, DispenseStatus status, String reason) {
        close(command, now, status, reason);
        InventoryItem bowl = items.findForUpdateById(command.getInventoryItemId()).orElseThrow();
        if (bowl.getStatus() == InventoryStatus.RESERVED) {
            bowl.setStatus(InventoryStatus.DISPENSE_FAILED);
            append(bowl, order, InventoryTransactionType.ADJUSTMENT, reason, InventoryStatus.RESERVED, InventoryStatus.DISPENSE_FAILED);
        }
        failOrder(order);
        // The failure is published before its consequence, so the machine history reads failure -> maintenance (issue #56).
        events.publishEvent(new DispenseFailedEvent(command.getId(), command.getCommandCode(), command.getMachineId(), command.getSlotId(),
                order.getId(), reason, false));
        machineService.enterMaintenanceBySystem(command.getMachineId(), reason);
        flush();
    }

    private void close(DispenseCommand command, Instant now, DispenseStatus status, String reason) {
        if (!DispenseFailureReason.WRITABLE.contains(reason)) throw new IllegalArgumentException("Unknown dispense failure reason");
        command.setStatus(status);
        command.setFailureReason(reason);
        if (command.getSentAt() != null) command.setCompletedAt(notBefore(now, command.getSentAt()));
        lastAttempt.remove(command.getId());
    }

    /** The payment stays SUCCESS, so a DISPENSE_FAILED order is a refund candidate. */
    private static void failOrder(Order order) {
        if (order.getStatus() == OrderStatus.PAID || order.getStatus() == OrderStatus.DISPENSING) order.setStatus(OrderStatus.DISPENSE_FAILED);
    }

    private boolean resultTimeoutDue(DispenseStatus status, Instant sentAt, Instant now) {
        return IN_FLIGHT.contains(status) && sentAt != null && !sentAt.plus(properties.timeout()).isAfter(now);
    }

    private static boolean mayChangeMachine(DispenseReport report) {
        return switch (report.eventType()) {
            case EVENT_ABORTED -> true;
            case EVENT_REJECTED -> report.reason() != null && DispenseFailureReason.NOT_EXECUTED.contains(report.reason());
            case EVENT_COMPLETED -> report.severalBowls();
            default -> false;
        };
    }

    private void markSent(DispenseCommand command, Instant now) {
        if (command.getStatus() != DispenseStatus.PENDING) return;
        command.setStatus(DispenseStatus.SENT);
        // First successful delivery; re-sends never move it, so the result timeout counts from here.
        command.setSentAt(notBefore(now, command.getCreatedAt()));
    }

    private void audit(String action, DispenseCommand command, Order order, InventoryItem bowl) {
        var row = new AuditLog();
        // user stays NULL: the machine reported this, no user acted.
        row.setAction(action);
        row.setEntityType("DispenseCommand");
        row.setEntityId(command.getId());
        row.setNewValue(JsonNodeFactory.instance.objectNode()
                .put("commandCode", command.getCommandCode())
                .put("commandStatus", command.getStatus().name())
                .put("failureReason", command.getFailureReason())
                .put("orderId", order.getId().toString())
                .put("orderStatus", order.getStatus().name())
                .put("inventoryItemId", bowl.getId().toString())
                .put("inventoryStatus", bowl.getStatus().name()));
        audits.save(row);
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
        audits.flush();
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
