package com.fruitmachine.backend.maintenance.service;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fruitmachine.backend.audit.entity.AuditLog;
import com.fruitmachine.backend.audit.repository.AuditLogRepository;
import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.config.properties.MaintenanceCommandProperties;
import com.fruitmachine.backend.dispense.enums.DispenseStatus;
import com.fruitmachine.backend.dispense.repository.DispenseCommandRepository;
import com.fruitmachine.backend.dispense.service.MachineCommandGateway;
import com.fruitmachine.backend.inventory.entity.InventoryItem;
import com.fruitmachine.backend.inventory.enums.InventoryStatus;
import com.fruitmachine.backend.inventory.repository.InventoryItemRepository;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.machine.entity.MachineSlot;
import com.fruitmachine.backend.machine.enums.MachineConnectivity;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.machine.repository.MachineCommandLockRepository;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.machine.repository.MachineSlotRepository;
import com.fruitmachine.backend.machine.service.ConnectivityEvaluator;
import com.fruitmachine.backend.maintenance.dto.CreateMaintenanceCommandRequest;
import com.fruitmachine.backend.maintenance.dto.MaintenanceCommandPageResponse;
import com.fruitmachine.backend.maintenance.dto.MaintenanceCommandResponse;
import com.fruitmachine.backend.maintenance.dto.ReconcileMaintenanceCommandRequest;
import com.fruitmachine.backend.maintenance.dto.ResetMachineRequest;
import com.fruitmachine.backend.maintenance.entity.MaintenanceCommand;
import com.fruitmachine.backend.maintenance.enums.MaintenanceCommandStatus;
import com.fruitmachine.backend.maintenance.enums.MaintenanceOperation;
import com.fruitmachine.backend.maintenance.enums.MaintenanceReason;
import com.fruitmachine.backend.maintenance.enums.ReconciliationOutcome;
import com.fruitmachine.backend.maintenance.event.MaintenanceCommandRequestedEvent;
import com.fruitmachine.backend.maintenance.repository.MaintenanceCommandRepository;
import com.fruitmachine.backend.mqtt.contract.MachineErrorCode;
import com.fruitmachine.backend.mqtt.contract.MachineEventType;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.repository.UserRepository;
import jakarta.persistence.criteria.Predicate;
import jakarta.validation.Valid;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;

/**
 * Maintenance commands (issue #64): creation under locks, delivery, machine reports, timeouts and Staff reconciliation.
 *
 * <p>Lock order, everywhere: machine command advisory lock (shared with dispense, so dispense and maintenance never overlap),
 * Machine row, Slot row, MaintenanceCommand row, InventoryItem rows. Inventory changes only on COMPLETED or reconciliation DONE,
 * exactly once (status check under the command row lock). 409 messages start with a stable code, e.g. {@code MACHINE_OFFLINE: ...}.
 */
@Slf4j
@Service
@Validated
@RequiredArgsConstructor
@EnableConfigurationProperties(MaintenanceCommandProperties.class)
public class MaintenanceCommandService {
    public static final String MACHINE_NOT_IN_MAINTENANCE = "MACHINE_NOT_IN_MAINTENANCE";
    public static final String MACHINE_COMMAND_IN_PROGRESS = "MACHINE_COMMAND_IN_PROGRESS";
    public static final String MACHINE_OFFLINE = "MACHINE_OFFLINE";
    public static final String SLOT_HAS_RESERVED_ITEM = "SLOT_HAS_RESERVED_ITEM";
    public static final String NOT_HEAD_ITEM = "NOT_HEAD_ITEM";
    public static final String SLOT_EMPTY = "SLOT_EMPTY";
    public static final String HEAD_NOT_REMOVABLE = "HEAD_NOT_REMOVABLE";
    public static final String REFILL_GATE_OPEN = "REFILL_GATE_OPEN";
    public static final String IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED";
    public static final String NOT_RECONCILABLE = "NOT_RECONCILABLE";
    public static final String EFFECT_NOT_POSSIBLE = "EFFECT_NOT_POSSIBLE";
    public static final String AUDIT_RECONCILED = "MAINTENANCE_COMMAND_RECONCILED";
    public static final String WORK_ORDER_OTHER_MACHINE = "WORK_ORDER_OTHER_MACHINE";
    public static final String WORK_ORDER_NOT_IN_PROGRESS = "WORK_ORDER_NOT_IN_PROGRESS";

    public static final String ACCEPT_TIMEOUT = "ACCEPT_TIMEOUT";
    public static final String COMPLETE_TIMEOUT = "COMPLETE_TIMEOUT";
    public static final String HEAD_CHANGED = "HEAD_CHANGED";
    public static final String ACCEPTED_AFTER_TIMEOUT = "ACCEPTED_AFTER_TIMEOUT";
    public static final String MACHINE_LEFT_MAINTENANCE = "MACHINE_LEFT_MAINTENANCE";
    static final Pattern IDEMPOTENCY_KEY = Pattern.compile("^[A-Za-z0-9_-]{8,64}$");
    static final String FAULT_STATE = "FAULT";
    private static final Set<MaintenanceCommandStatus> UNFINISHED = MaintenanceCommandStatus.UNFINISHED;
    private static final Set<MaintenanceCommandStatus> NOT_ACCEPTED = EnumSet.of(MaintenanceCommandStatus.PENDING, MaintenanceCommandStatus.SENT);
    private static final Set<DispenseStatus> DISPENSE_IN_FLIGHT = EnumSet.of(DispenseStatus.SENT, DispenseStatus.ACKNOWLEDGED);
    private static final Set<String> NOT_EXECUTED_INVALID = Set.of(MachineErrorCode.Reason.INVALID_COMMAND_ID.name(),
            MachineErrorCode.Reason.INVALID_COLUMN.name(), MachineErrorCode.Reason.UNSUPPORTED_SCHEMA.name());
    private static final int MAX_PAGE_SIZE = 100;

    public enum Outcome { APPLIED, DUPLICATE, IGNORED, UNKNOWN_COMMAND, WRONG_MACHINE }

    /** The created or the existing (same Idempotency-Key and body) command. */
    public record Created(MaintenanceCommandResponse command, boolean created) { }

    private final MaintenanceCommandRepository commands;
    private final MaintenanceEffectApplier effects;
    private final MachineRepository machines;
    private final MachineSlotRepository slots;
    private final InventoryItemRepository items;
    private final DispenseCommandRepository dispenseCommands;
    private final MachineCommandLockRepository machineLock;
    private final ConnectivityEvaluator connectivity;
    private final UserRepository users;
    private final AuditLogRepository audits;
    private final MachineCommandGateway gateway;
    private final ApplicationEventPublisher events;
    private final MaintenanceCommandProperties properties;
    private final Clock clock;
    private final jakarta.persistence.EntityManager entityManager;
    private final com.fruitmachine.backend.workorder.repository.WorkOrderRepository workOrders;
    /** Last delivery attempt per unfinished command, so the dispatcher re-sends only after resend-interval (single instance). */
    private final Map<UUID, Instant> lastAttempt = new ConcurrentHashMap<>();

    // ---- creation ----

    @Transactional
    @PreAuthorize(Permissions.HAS_MAINTENANCE_COMMAND_EXECUTE)
    public Created create(UUID machineId, UUID slotId, String idempotencyKey, @Valid CreateMaintenanceCommandRequest request) {
        if (request.operation() == MaintenanceOperation.RESET) throw new BadRequestException("RESET is sent with POST /api/v1/machines/{machineId}/reset");
        if (request.operation().removesBowls() && request.reason() == null) throw new BadRequestException("reason is required for " + request.operation());
        if (!request.operation().removesBowls() && request.reason() != null) throw new BadRequestException("reason is only used when bowls are removed");
        if (request.operation() != MaintenanceOperation.REMOVE_ITEM && request.inventoryItemId() != null)
            throw new BadRequestException("inventoryItemId is only used with REMOVE_ITEM");
        if (request.reason() == MaintenanceReason.OTHER && request.note() == null) throw new BadRequestException("note is required when reason is OTHER");
        return createCommand(machineId, slotId, idempotencyKey, request.operation(), request.reason(), request.note(), request.inventoryItemId(), request.workOrderId());
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_MACHINE_RESET)
    public Created reset(UUID machineId, String idempotencyKey, @Valid ResetMachineRequest request) {
        return createCommand(machineId, null, idempotencyKey, MaintenanceOperation.RESET, null, request == null ? null : request.note(), null, null);
    }

    private Created createCommand(UUID machineId, UUID slotId, String idempotencyKey, MaintenanceOperation operation, MaintenanceReason reason,
            String note, UUID inventoryItemId, UUID workOrderId) {
        if (idempotencyKey == null || !IDEMPOTENCY_KEY.matcher(idempotencyKey).matches())
            throw new BadRequestException("Idempotency-Key header is required: 8 to 64 characters of A-Z, a-z, 0-9, _ or -");
        User actor = actor();
        machineLock.acquire(machineId);
        var existing = commands.findByRequestedByIdAndIdempotencyKey(actor.getId(), idempotencyKey);
        if (existing.isPresent()) {
            MaintenanceCommand command = existing.get();
            boolean same = command.getMachineId().equals(machineId) && Objects.equals(command.getSlotId(), slotId) && command.getOperation() == operation
                    && command.getReason() == reason && Objects.equals(command.getNote(), note)
                    && (inventoryItemId == null || inventoryItemId.equals(command.getTargetInventoryItemId()))
                    && Objects.equals(command.getWorkOrderId(), workOrderId);
            if (!same) throw conflict(IDEMPOTENCY_KEY_REUSED, "this Idempotency-Key was already used for a different command");
            return new Created(response(commands.findDetailsById(command.getId()).orElseThrow()), false);
        }
        Machine machine = machines.findForUpdateById(machineId).orElseThrow(() -> new ResourceNotFoundException("Machine not found"));
        MachineSlot slot = slotId == null ? null
                : slots.findForUpdateByIdAndMachineId(slotId, machineId).orElseThrow(() -> new ResourceNotFoundException("Slot not found in specified machine"));
        if (machine.getStatus() != MachineStatus.MAINTENANCE)
            throw conflict(MACHINE_NOT_IN_MAINTENANCE, "maintenance commands need the machine in MAINTENANCE (sales stopped)");
        if (workOrderId != null) requireWorkOrder(workOrderId, machineId, actor);
        if (commands.existsByMachineIdAndStatusIn(machineId, UNFINISHED))
            throw conflict(MACHINE_COMMAND_IN_PROGRESS, "another maintenance command of this machine is not finished");
        if (dispenseCommands.existsByMachineIdAndStatusIn(machineId, DISPENSE_IN_FLIGHT))
            throw conflict(MACHINE_COMMAND_IN_PROGRESS, "a dispense command of this machine is running");
        if (connectivity.evaluate(machine) != MachineConnectivity.ONLINE)
            throw conflict(MACHINE_OFFLINE, "the machine is not online");

        InventoryItem target = null;
        if (slot != null) {
            if (items.countBySlotIdAndStatusIn(slot.getId(), Set.of(InventoryStatus.RESERVED)) > 0)
                throw conflict(SLOT_HAS_RESERVED_ITEM, "a bowl of this column is reserved for an order");
            switch (operation) {
                case REMOVE_ITEM -> {
                    requireGateClosed(slot);
                    var heads = items.findHeadCandidates(slot.getId(), MaintenanceEffectApplier.PHYSICAL, PageRequest.of(0, 1));
                    if (heads.isEmpty()) throw conflict(SLOT_EMPTY, "the column holds no bowl");
                    target = items.findForUpdateById(heads.getFirst().getId()).orElseThrow();
                    if (inventoryItemId != null && !inventoryItemId.equals(target.getId()))
                        throw conflict(NOT_HEAD_ITEM, "only the head bowl (above the lower gate) can be removed");
                    if (!MaintenanceEffectApplier.REMOVABLE.contains(target.getStatus()))
                        throw conflict(HEAD_NOT_REMOVABLE, "the head bowl is " + target.getStatus());
                }
                case EMPTY_COLUMN -> {
                    requireGateClosed(slot);
                    if (items.countBySlotIdAndStatusIn(slot.getId(), MaintenanceEffectApplier.REMOVABLE) == 0)
                        throw conflict(SLOT_EMPTY, "the column holds no bowl");
                }
                case OPEN_REFILL -> {
                    if (slot.isRefillGateOpen()) throw conflict(REFILL_GATE_OPEN, "the refill gate is already open");
                }
                default -> { }
            }
        }

        var command = new MaintenanceCommand();
        command.setCommandCode(newCode());
        command.setMachineId(machineId);
        command.setSlotId(slotId);
        command.setOperation(operation);
        command.setReason(reason);
        command.setNote(note);
        command.setTargetInventoryItemId(target == null ? null : target.getId());
        command.setRequestedBy(actor);
        command.setIdempotencyKey(idempotencyKey);
        command.setWorkOrderId(workOrderId);
        commands.saveAndFlush(command);
        // The read-only machine/slot/target associations of a new entity are only populated by a reload.
        entityManager.refresh(command);
        events.publishEvent(new MaintenanceCommandRequestedEvent(command.getId()));
        log.info("Maintenance command {} {} created for machine {} by {}", command.getCommandCode(), operation, machine.getCode(), actor.getEmail());
        return new Created(response(commands.findDetailsById(command.getId()).orElseThrow()), true);
    }

    /** Issue #68: the command may serve an IN_PROGRESS work order of the same machine that the caller executes (others are 404). */
    private void requireWorkOrder(UUID workOrderId, UUID machineId, User actor) {
        var order = workOrders.findById(workOrderId).orElseThrow(() -> new ResourceNotFoundException("Work order not found"));
        boolean assignee = order.getAssignee() != null && order.getAssignee().getId().equals(actor.getId());
        if (!assignee && !has(Permissions.WORK_ORDER_MANAGE)) throw new ResourceNotFoundException("Work order not found");
        if (!order.getMachineId().equals(machineId)) throw conflict(WORK_ORDER_OTHER_MACHINE, "the work order belongs to another machine");
        if (order.getStatus() != com.fruitmachine.backend.workorder.enums.WorkOrderStatus.IN_PROGRESS)
            throw conflict(WORK_ORDER_NOT_IN_PROGRESS, "the work order is " + order.getStatus() + "; start it first");
    }

    private static boolean has(String authority) {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null && authentication.getAuthorities().stream().anyMatch(a -> authority.equals(a.getAuthority()));
    }

    private static void requireGateClosed(MachineSlot slot) {
        if (slot.isRefillGateOpen()) throw conflict(REFILL_GATE_OPEN, "close the refill gate first (CLOSE_REFILL)");
    }

    // ---- delivery and timeouts ----

    /** First delivery right after the creating transaction committed; skipped when the machine is busy (the dispatcher retries). */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void send(UUID commandId) {
        UUID machineId = commands.findMachineIdById(commandId).orElse(null);
        if (machineId == null || !machineLock.tryAcquire(machineId)) return;
        Machine machine = machines.findForShareById(machineId).orElseThrow();
        MaintenanceCommand command = commands.findForUpdateById(commandId).orElseThrow();
        if (NOT_ACCEPTED.contains(command.getStatus())) publish(command, machine, now());
    }

    @Transactional(readOnly = true)
    public List<UUID> openCommandIds(int limit) {
        return commands.findIdsByStatusIn(UNFINISHED, PageRequest.of(0, limit));
    }

    /** Dispatcher step for one unfinished command: time it out, or (re-)publish it when due. */
    @Transactional
    public void expireOrResend(UUID commandId) {
        UUID machineId = commands.findMachineIdById(commandId).orElse(null);
        if (machineId == null) return;
        machineLock.acquire(machineId);
        Machine machine = machines.findForShareById(machineId).orElseThrow();
        MaintenanceCommand command = commands.findForUpdateById(commandId).orElseThrow();
        Instant now = now();
        switch (command.getStatus()) {
            case PENDING, SENT -> {
                if (!command.getCreatedAt().plus(properties.acceptTimeout()).isAfter(now)) {
                    finish(command, MaintenanceCommandStatus.FAILED, ACCEPT_TIMEOUT, now);
                    log.warn("Maintenance command {} was not accepted within {}: FAILED", command.getCommandCode(), properties.acceptTimeout());
                    return;
                }
                Instant last = lastAttempt.get(commandId);
                if (last == null || !last.plus(properties.resendInterval()).isAfter(now)) publish(command, machine, now);
            }
            case ACCEPTED -> {
                if (!command.getAcceptedAt().plus(properties.completeTimeout()).isAfter(now)) {
                    finish(command, MaintenanceCommandStatus.NEEDS_RECONCILIATION, COMPLETE_TIMEOUT, now);
                    log.warn("Maintenance command {} accepted but not completed within {}: needs reconciliation", command.getCommandCode(),
                            properties.completeTimeout());
                }
            }
            default -> lastAttempt.remove(commandId);
        }
    }

    /** Caller holds the machine command lock. A command that cannot be delivered now is retried by the dispatcher. */
    private void publish(MaintenanceCommand command, Machine machine, Instant now) {
        if (machine.getStatus() != MachineStatus.MAINTENANCE) {
            log.debug("Maintenance command {} waits: machine {} is {}", command.getCommandCode(), machine.getCode(), machine.getStatus());
            return;
        }
        if (dispenseCommands.existsByMachineIdAndStatusIn(machine.getId(), DISPENSE_IN_FLIGHT)) return;
        lastAttempt.put(command.getId(), now);
        boolean delivered = command.getOperation() == MaintenanceOperation.RESET
                ? gateway.sendReset(machine.getCode(), command.getCommandCode())
                : gateway.sendMaintenance(machine.getCode(), command.getOperation().commandType(), command.getCommandCode(), command.getSlot().getSlotCode());
        if (!delivered) return;
        command.setAttemptCount(command.getAttemptCount() + 1);
        if (command.getStatus() == MaintenanceCommandStatus.PENDING) {
            command.setStatus(MaintenanceCommandStatus.SENT);
            command.setSentAt(notBefore(now, command.getCreatedAt()));
        }
        commands.flush();
    }

    // ---- machine reports ----

    /** Applies a machine report; unknown codes, other machines, wrong prefixes and repeats change nothing. Never throws for bad input. */
    @Transactional
    public Outcome handleMachineEvent(String machineCode, MaintenanceReport report) {
        var route = report.commandCode() == null ? null : commands.findRouteByCommandCode(report.commandCode()).orElse(null);
        if (route == null) return Outcome.UNKNOWN_COMMAND;
        if (!route.getMachineCode().equals(machineCode)) {
            log.warn("Machine {} reported {} for maintenance command {} of another machine; ignored", machineCode, report.eventType(), report.commandCode());
            return Outcome.WRONG_MACHINE;
        }
        String prefix = route.getOperation().commandType() + "_";
        if (report.eventType() == null || !report.eventType().startsWith(prefix)) {
            log.warn("Machine {} reported {} for {} command {}; ignored", machineCode, report.eventType(), route.getOperation(), report.commandCode());
            return Outcome.IGNORED;
        }
        String phase = report.eventType().substring(prefix.length());
        if (!MachineEventType.LIFECYCLE.get(route.getOperation().commandType()).contains(phase)) return Outcome.IGNORED;
        machineLock.acquire(route.getMachineId());
        MaintenanceCommand command = commands.findForUpdateById(route.getId()).orElseThrow();
        Instant now = now();
        Outcome outcome = switch (phase) {
            case MachineEventType.ACCEPTED -> accepted(command, now);
            case MachineEventType.COMPLETED -> completed(command, now);
            case MachineEventType.ABORTED -> aborted(command, report, now);
            default -> rejected(command, report, now);
        };
        commands.flush();
        return outcome;
    }

    private Outcome accepted(MaintenanceCommand command, Instant now) {
        switch (command.getStatus()) {
            case PENDING, SENT -> {
                if (command.getSentAt() == null) command.setSentAt(notBefore(now, command.getCreatedAt()));
                command.setAcceptedAt(notBefore(now, command.getSentAt()));
                // RESET has no cycle: accepting it is its result; FAULT_CLEARED (alerts) follows.
                if (command.getOperation() == MaintenanceOperation.RESET) finish(command, MaintenanceCommandStatus.COMPLETED, null, now);
                else command.setStatus(MaintenanceCommandStatus.ACCEPTED);
                return Outcome.APPLIED;
            }
            case FAILED -> {
                if (!ACCEPT_TIMEOUT.equals(command.getFailureReason()) || command.getOperation() == MaintenanceOperation.RESET) return Outcome.IGNORED;
                // Given up too early: the machine may be moving now, so Staff has to check what happened.
                command.setAcceptedAt(notBefore(now, command.getSentAt() == null ? command.getCreatedAt() : command.getSentAt()));
                command.setStatus(MaintenanceCommandStatus.NEEDS_RECONCILIATION);
                command.setFailureReason(ACCEPTED_AFTER_TIMEOUT);
                log.warn("Maintenance command {} accepted after its timeout: needs reconciliation", command.getCommandCode());
                return Outcome.APPLIED;
            }
            default -> {
                return Outcome.DUPLICATE;
            }
        }
    }

    /** The machine is the witness of the physical action: applied once, also late (after FAILED or NEEDS_RECONCILIATION). */
    private Outcome completed(MaintenanceCommand command, Instant now) {
        if (command.getStatus() == MaintenanceCommandStatus.COMPLETED || command.getStatus() == MaintenanceCommandStatus.RECONCILED) return Outcome.DUPLICATE;
        if (command.getSentAt() == null) command.setSentAt(notBefore(now, command.getCreatedAt()));
        if (command.getAcceptedAt() == null) command.setAcceptedAt(notBefore(now, command.getSentAt()));
        if (effects.apply(command, now) == MaintenanceEffectApplier.Result.HEAD_CHANGED) {
            finish(command, MaintenanceCommandStatus.NEEDS_RECONCILIATION, HEAD_CHANGED, now);
            log.warn("Maintenance command {} completed but the head bowl changed meanwhile: nothing removed, needs reconciliation", command.getCommandCode());
            return Outcome.APPLIED;
        }
        finish(command, MaintenanceCommandStatus.COMPLETED, null, now);
        return Outcome.APPLIED;
    }

    private Outcome aborted(MaintenanceCommand command, MaintenanceReport report, Instant now) {
        if (!command.getStatus().unfinished()) return Outcome.IGNORED;
        String reason = report.reason() == null ? "ABORTED" : "ABORTED_" + report.reason();
        finish(command, MaintenanceCommandStatus.NEEDS_RECONCILIATION, reason.length() > 48 ? reason.substring(0, 48) : reason, now);
        log.warn("Maintenance command {} aborted ({}): needs reconciliation", command.getCommandCode(), reason);
        return Outcome.APPLIED;
    }

    /**
     * BUSY or a busy controller state: the command stays SENT and is re-sent. CONTROLLER_FAULT or the FAULT state: FAILED.
     * INVALID_* / UNSUPPORTED_SCHEMA: FAILED and an ERROR (a backend bug). A rejection after ACCEPTED contradicts the machine's own
     * report: Staff checks.
     */
    private Outcome rejected(MaintenanceCommand command, MaintenanceReport report, Instant now) {
        if (!command.getStatus().unfinished()) return Outcome.IGNORED;
        String reason = report.reason();
        boolean fault = MachineErrorCode.Reason.CONTROLLER_FAULT.name().equals(reason) || (reason == null && FAULT_STATE.equals(report.state()));
        boolean invalid = reason != null && NOT_EXECUTED_INVALID.contains(reason);
        if (!fault && !invalid) return Outcome.IGNORED;
        if (command.getStatus() == MaintenanceCommandStatus.ACCEPTED) {
            finish(command, MaintenanceCommandStatus.NEEDS_RECONCILIATION, fault ? MachineErrorCode.Reason.CONTROLLER_FAULT.name() : reason, now);
            return Outcome.APPLIED;
        }
        finish(command, MaintenanceCommandStatus.FAILED, fault ? MachineErrorCode.Reason.CONTROLLER_FAULT.name() : reason, now);
        if (invalid) log.error("Machine {} rejected maintenance command {} as {}: the backend sent a command this firmware cannot run",
                command.getMachineId(), command.getCommandCode(), reason);
        return Outcome.APPLIED;
    }

    private void finish(MaintenanceCommand command, MaintenanceCommandStatus status, String failureReason, Instant now) {
        command.setStatus(status);
        command.setFailureReason(failureReason);
        command.setFinishedAt(notBefore(now, command.getCreatedAt()));
        lastAttempt.remove(command.getId());
        commands.flush();
    }

    // ---- reconciliation ----

    @Transactional
    @PreAuthorize(Permissions.HAS_MAINTENANCE_COMMAND_EXECUTE)
    public MaintenanceCommandResponse reconcile(UUID id, @Valid ReconcileMaintenanceCommandRequest request) {
        UUID machineId = commands.findMachineIdById(id).orElseThrow(() -> new ResourceNotFoundException("Maintenance command not found"));
        User actor = actor();
        machineLock.acquire(machineId);
        MaintenanceCommand command = commands.findForUpdateById(id).orElseThrow();
        if (command.getStatus() != MaintenanceCommandStatus.NEEDS_RECONCILIATION || command.getOperation() == MaintenanceOperation.RESET)
            throw conflict(NOT_RECONCILABLE, "only a NEEDS_RECONCILIATION command can be reconciled (status " + command.getStatus() + ")");
        Instant now = now();
        String before = command.getStatus().name();
        if (request.outcome() == ReconciliationOutcome.DONE
                && effects.apply(command, now) == MaintenanceEffectApplier.Result.HEAD_CHANGED)
            throw conflict(EFFECT_NOT_POSSIBLE, "the head bowl is no longer the one this command was created for; reconcile NOT_DONE and remove it again");
        command.setStatus(MaintenanceCommandStatus.RECONCILED);
        command.setReconciliationOutcome(request.outcome());
        command.setReconciledBy(actor);
        command.setReconciledAt(notBefore(now, command.getCreatedAt()));
        commands.flush();

        var audit = new AuditLog();
        audit.setUser(actor);
        audit.setAction(AUDIT_RECONCILED);
        audit.setEntityType("MaintenanceCommand");
        audit.setEntityId(command.getId());
        audit.setOldValue(JsonNodeFactory.instance.objectNode().put("status", before).put("failureReason", command.getFailureReason()));
        audit.setNewValue(JsonNodeFactory.instance.objectNode().put("status", MaintenanceCommandStatus.RECONCILED.name())
                .put("outcome", request.outcome().name()).put("note", request.note())
                .put("removedCount", command.getRemovedCount() == null ? null : command.getRemovedCount()));
        audits.save(audit);
        return response(commands.findDetailsById(id).orElseThrow());
    }

    // ---- reads ----

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_MAINTENANCE_COMMAND_READ)
    public MaintenanceCommandPageResponse list(UUID machineId, UUID slotId, MaintenanceOperation operation, MaintenanceCommandStatus status,
            Instant from, Instant to, int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) throw new BadRequestException("Page must be nonnegative and size between 1 and " + MAX_PAGE_SIZE);
        if (from != null && to != null && !to.isAfter(from)) throw new BadRequestException("to must be after from");
        Specification<MaintenanceCommand> filter = (root, query, cb) -> {
            var predicates = new ArrayList<Predicate>();
            if (machineId != null) predicates.add(cb.equal(root.get("machineId"), machineId));
            if (slotId != null) predicates.add(cb.equal(root.get("slotId"), slotId));
            if (operation != null) predicates.add(cb.equal(root.get("operation"), operation));
            if (status != null) predicates.add(cb.equal(root.get("status"), status));
            if (from != null) predicates.add(cb.greaterThanOrEqualTo(root.get("createdAt"), from));
            if (to != null) predicates.add(cb.lessThan(root.get("createdAt"), to));
            return cb.and(predicates.toArray(Predicate[]::new));
        };
        var result = commands.findAll(filter, PageRequest.of(page, size, Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))));
        return new MaintenanceCommandPageResponse(result.getContent().stream().map(MaintenanceCommandService::response).toList(), page, size,
                result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_MAINTENANCE_COMMAND_READ)
    public MaintenanceCommandResponse get(UUID id) {
        return response(commands.findDetailsById(id).orElseThrow(() -> new ResourceNotFoundException("Maintenance command not found")));
    }

    static MaintenanceCommandResponse response(MaintenanceCommand c) {
        var item = c.getTargetItem();
        var target = item == null ? null : new MaintenanceCommandResponse.MaintenanceTargetItem(item.getId(), item.getBatch().getProduct().getId(),
                item.getBatch().getProduct().getName(), item.getBatch().getId(), item.getBatch().getBatchCode());
        return new MaintenanceCommandResponse(c.getId(), c.getCommandCode(), c.getMachineId(), c.getMachine().getCode(), c.getSlotId(),
                c.getSlot() == null ? null : c.getSlot().getSlotCode(), c.getOperation(), c.getStatus(), c.getReason(), c.getNote(), target,
                actor(c.getRequestedBy()), c.getWorkOrderId(), c.getAttemptCount(), c.getCreatedAt(), c.getSentAt(), c.getAcceptedAt(), c.getFinishedAt(),
                c.getFailureReason(), c.getRemovedCount(), c.getReconciliationOutcome(), actor(c.getReconciledBy()), c.getReconciledAt());
    }

    private static MaintenanceCommandResponse.MaintenanceActor actor(User user) {
        return user == null ? null : new MaintenanceCommandResponse.MaintenanceActor(user.getId(), user.getFullName());
    }

    private User actor() {
        var principal = (AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        return users.findById(principal.getId()).orElseThrow(() -> new ResourceNotFoundException("Actor not found"));
    }

    private static ConflictException conflict(String code, String message) {
        return new ConflictException(code + ": " + message);
    }

    private String newCode() {
        String code;
        do {
            code = "MC-" + UUID.randomUUID().toString().replace("-", "");
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
