package com.fruitmachine.backend.workorder.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fruitmachine.backend.alert.entity.Alert;
import com.fruitmachine.backend.alert.enums.AlertSeverity;
import com.fruitmachine.backend.alert.enums.AlertStatus;
import com.fruitmachine.backend.alert.enums.AlertType;
import com.fruitmachine.backend.alert.repository.AlertRepository;
import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.common.request.TimeRange;
import com.fruitmachine.backend.dispense.enums.DispenseStatus;
import com.fruitmachine.backend.dispense.repository.DispenseCommandRepository;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.machine.repository.MachineCommandLockRepository;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.machine.service.MachineService;
import com.fruitmachine.backend.maintenance.enums.MaintenanceCommandStatus;
import com.fruitmachine.backend.maintenance.repository.MaintenanceCommandRepository;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.order.repository.OrderRepository;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.repository.UserRepository;
import com.fruitmachine.backend.workorder.dto.*;
import com.fruitmachine.backend.workorder.entity.WorkOrder;
import com.fruitmachine.backend.workorder.entity.WorkOrderAlert;
import com.fruitmachine.backend.workorder.entity.WorkOrderAlertId;
import com.fruitmachine.backend.workorder.entity.WorkOrderEvent;
import com.fruitmachine.backend.workorder.enums.*;
import com.fruitmachine.backend.workorder.event.WorkOrderNotice;
import com.fruitmachine.backend.workorder.repository.WorkOrderAlertRepository;
import com.fruitmachine.backend.workorder.repository.WorkOrderEventRepository;
import com.fruitmachine.backend.workorder.repository.WorkOrderRepository;
import jakarta.persistence.EntityManager;
import jakarta.validation.Valid;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;

/**
 * Work order lifecycle (issue #66). Lock order: machine command advisory lock and Machine row (start only), Alert rows, WorkOrder
 * row. Every action writes exactly one work_order_events row; notifications are created after the commit (WorkOrderNotifier) and
 * never roll a work order back. STAFF sees only work orders assigned to them: anything else is 404, never 403. 409 messages
 * start with a code, e.g. {@code INVALID_WORK_ORDER_TRANSITION: ...}.
 */
@Slf4j
@Service
@Validated
@RequiredArgsConstructor
public class WorkOrderService {
    public static final String INVALID_TRANSITION = "INVALID_WORK_ORDER_TRANSITION";
    public static final String STALE_VERSION = "STALE_VERSION";
    public static final String MACHINE_INACTIVE = "MACHINE_INACTIVE";
    public static final String MACHINE_HAS_ACTIVE_ORDERS = "MACHINE_HAS_ACTIVE_ORDERS";
    public static final String MACHINE_COMMAND_IN_PROGRESS = "MACHINE_COMMAND_IN_PROGRESS";
    public static final String ALERT_ALREADY_HANDLED = "ALERT_ALREADY_HANDLED";
    public static final String ALERT_RESOLVED = "ALERT_RESOLVED";
    static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_CODE_ATTEMPTS = 5;
    private static final Set<OrderStatus> ACTIVE_ORDERS = EnumSet.of(OrderStatus.PENDING_PAYMENT, OrderStatus.PAID, OrderStatus.DISPENSING);
    private static final Set<DispenseStatus> OPEN_DISPENSE = EnumSet.of(DispenseStatus.PENDING, DispenseStatus.SENT, DispenseStatus.ACKNOWLEDGED);
    private static final Set<AlertType> RESTOCK_ALERTS = EnumSet.of(AlertType.LOW_STOCK, AlertType.PRODUCT_EXPIRING, AlertType.PRODUCT_EXPIRED);

    private final WorkOrderRepository workOrders;
    private final WorkOrderEventRepository history;
    private final WorkOrderAlertRepository links;
    private final WorkOrderCodeGenerator codes;
    private final List<WorkOrderCompletionCheck> completionChecks;
    private final MachineRepository machines;
    private final MachineCommandLockRepository machineLock;
    private final MachineService machineService;
    private final OrderRepository orders;
    private final DispenseCommandRepository dispenseCommands;
    private final MaintenanceCommandRepository maintenanceCommands;
    private final AlertRepository alerts;
    private final UserRepository users;
    private final ApplicationEventPublisher events;
    private final EntityManager entityManager;
    private final ObjectMapper json;
    private final Clock clock;

    // ---- creation ----

    @Transactional
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    public WorkOrderResponse create(@Valid CreateWorkOrderRequest request) {
        User actor = actor();
        Machine machine = machines.findById(request.machineId()).orElseThrow(() -> new ResourceNotFoundException("Machine not found"));
        if (machine.getStatus() == MachineStatus.INACTIVE) throw conflict(MACHINE_INACTIVE, "work orders need an ACTIVE or MAINTENANCE machine");
        Instant now = now();
        requireFuture(request.dueAt(), now);
        User assignee = request.assigneeId() == null ? null : assignee(request.assigneeId());
        WorkOrder order = newWorkOrder(request.type(), WorkOrderSource.MANUAL, machine.getId(), request.title(), request.description(),
                request.priority(), request.dueAt(), actor, assignee);
        return response(order.getId());
    }

    /** Admin turns an alert into work: linked, the alert is acknowledged, defaults come from the alert. */
    @Transactional
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    public WorkOrderResponse createFromAlert(UUID alertId, @Valid CreateWorkOrderFromAlertRequest request) {
        User actor = actor();
        CreateWorkOrderFromAlertRequest body = request == null ? new CreateWorkOrderFromAlertRequest(null, null, null, null, null, null) : request;
        Alert alert = alerts.findForUpdateById(alertId).orElseThrow(() -> new ResourceNotFoundException("Alert not found"));
        if (alert.getStatus() == AlertStatus.RESOLVED) throw conflict(ALERT_RESOLVED, "the alert is already resolved");
        requireNotHandled(alert.getId(), null);
        Instant now = now();
        requireFuture(body.dueAt(), now);
        User assignee = body.assigneeId() == null ? null : assignee(body.assigneeId());
        WorkOrderType type = body.type() != null ? body.type() : RESTOCK_ALERTS.contains(alert.getType()) ? WorkOrderType.RESTOCK : WorkOrderType.MAINTENANCE;
        String title = body.title() != null ? body.title() : truncate(alert.getTitle(), 200);
        WorkOrderPriority priority = body.priority() != null ? body.priority() : WorkOrderPriority.of(alert.getSeverity());
        WorkOrder order = newWorkOrder(type, WorkOrderSource.ALERT, alert.getMachine().getId(), title, body.description(), priority, body.dueAt(), actor, assignee);
        link(order, alert);
        if (alert.getStatus() == AlertStatus.OPEN) {
            alert.setStatus(AlertStatus.ACKNOWLEDGED);
            alert.setAcknowledgedAt(notBefore(now, alert.getTriggeredAt()));
            alert.setAcknowledgedBy(actor);
        }
        alerts.flush();
        return response(order.getId());
    }

    /**
     * Internal API for 4.5 schedules and 5.2 customer reports (no REST): created by the system (created_by NULL), unassigned, and
     * announced to every WORK_ORDER_MANAGE holder. Joins the caller's transaction.
     */
    @Transactional
    public WorkOrder createBySystem(WorkOrderType type, WorkOrderSource source, UUID machineId, String title, String description,
            WorkOrderPriority priority, Instant dueAt, List<UUID> alertIds) {
        if (source == WorkOrderSource.MANUAL) throw new IllegalArgumentException("System work orders are not MANUAL");
        machines.findById(machineId).orElseThrow(() -> new ResourceNotFoundException("Machine not found"));
        WorkOrder order = newWorkOrder(type, source, machineId, title, description, priority, dueAt, null, null);
        for (UUID alertId : alertIds == null ? List.<UUID>of() : alertIds) {
            Alert alert = alerts.findForUpdateById(alertId).orElseThrow(() -> new ResourceNotFoundException("Alert not found"));
            if (!alert.getMachine().getId().equals(machineId)) throw new BadRequestException("Alert belongs to another machine");
            requireNotHandled(alertId, order.getId());
            link(order, alert);
        }
        return order;
    }

    private WorkOrder newWorkOrder(WorkOrderType type, WorkOrderSource source, UUID machineId, String title, String description,
            WorkOrderPriority priority, Instant dueAt, User creator, User assignee) {
        if (title == null || title.isBlank()) throw new BadRequestException("title is required");
        var order = new WorkOrder();
        order.setCode(newCode());
        order.setType(type);
        order.setSource(source);
        order.setMachineId(machineId);
        order.setTitle(title.strip());
        order.setDescription(description);
        order.setPriority(priority == null ? WorkOrderPriority.NORMAL : priority);
        order.setDueAt(dueAt);
        order.setCreatedBy(creator);
        order.setAssignee(assignee);
        order.setStatus(assignee == null ? WorkOrderStatus.OPEN : WorkOrderStatus.ASSIGNED);
        workOrders.saveAndFlush(order);
        entityManager.refresh(order);
        ObjectNode details = JsonNodeFactory.instance.objectNode().put("type", type.name()).put("source", source.name()).put("priority", order.getPriority().name());
        if (assignee != null) details.put("assigneeId", assignee.getId().toString());
        if (dueAt != null) details.put("dueAt", dueAt.toString());
        record(order, WorkOrderEventType.CREATED, null, order.getStatus(), creator, null, details);
        if (assignee != null) notice(order, WorkOrderNotice.Kind.ASSIGNED, creator);
        else if (creator == null) notice(order, WorkOrderNotice.Kind.SYSTEM_CREATED, null);
        log.info("Work order {} ({}, {}) created for machine {}", order.getCode(), type, source, machineId);
        return order;
    }

    // ---- management ----

    @Transactional
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    public WorkOrderResponse update(UUID id, @Valid UpdateWorkOrderRequest request) {
        User actor = actor();
        WorkOrder order = lock(id);
        requireVersion(order, request.version());
        requireUnfinished(order, "edit");
        ObjectNode changes = JsonNodeFactory.instance.objectNode();
        if (request.title() != null) {
            if (request.title().isBlank()) throw new BadRequestException("title must not be blank");
            change(changes, "title", order.getTitle(), request.title().strip());
            order.setTitle(request.title().strip());
        }
        if (request.description() != null) {
            String description = request.description().isBlank() ? null : request.description().strip();
            change(changes, "description", order.getDescription(), description);
            order.setDescription(description);
        }
        if (request.priority() != null) {
            change(changes, "priority", order.getPriority().name(), request.priority().name());
            order.setPriority(request.priority());
        }
        if (request.dueAt() != null && !request.dueAt().equals(order.getDueAt())) {
            requireFuture(request.dueAt(), now());
            change(changes, "dueAt", order.getDueAt() == null ? null : order.getDueAt().toString(), request.dueAt().toString());
            order.setDueAt(request.dueAt());
            // A new due time re-arms the overdue notification.
            order.setOverdueNotifiedAt(null);
        }
        if (changes.isEmpty()) return response(id);
        workOrders.flush();
        record(order, WorkOrderEventType.UPDATED, order.getStatus(), order.getStatus(), actor, null, changes);
        return response(id);
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    public WorkOrderResponse assign(UUID id, @Valid AssignWorkOrderRequest request) {
        User actor = actor();
        WorkOrder order = lock(id);
        requireVersion(order, request.version());
        requireUnfinished(order, "assign");
        User assignee = assignee(request.assigneeId());
        User previous = order.getAssignee();
        if (previous != null && previous.getId().equals(assignee.getId())) return response(id);
        WorkOrderStatus before = order.getStatus();
        order.setAssignee(assignee);
        // IN_PROGRESS stays IN_PROGRESS when the work is handed over.
        if (before == WorkOrderStatus.OPEN) order.setStatus(WorkOrderStatus.ASSIGNED);
        workOrders.flush();
        ObjectNode details = JsonNodeFactory.instance.objectNode().put("assigneeId", assignee.getId().toString());
        if (previous != null) details.put("previousAssigneeId", previous.getId().toString());
        record(order, WorkOrderEventType.ASSIGNED, before, order.getStatus(), actor, null, details);
        notice(order, WorkOrderNotice.Kind.ASSIGNED, actor);
        return response(id);
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    public WorkOrderResponse unassign(UUID id, @Valid VersionRequest request) {
        User actor = actor();
        WorkOrder order = lock(id);
        requireVersion(order, request.version());
        if (order.getStatus() != WorkOrderStatus.ASSIGNED) throw transition(order, "unassign");
        UUID previous = order.getAssignee().getId();
        order.setAssignee(null);
        order.setStatus(WorkOrderStatus.OPEN);
        workOrders.flush();
        record(order, WorkOrderEventType.UNASSIGNED, WorkOrderStatus.ASSIGNED, WorkOrderStatus.OPEN, actor, null,
                JsonNodeFactory.instance.objectNode().put("previousAssigneeId", previous.toString()));
        return response(id);
    }

    /** Links stay as history; a cancelled work order no longer handles its alerts. The machine status is not changed. */
    @Transactional
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    public WorkOrderResponse cancel(UUID id, @Valid CancelWorkOrderRequest request) {
        User actor = actor();
        WorkOrder order = lock(id);
        requireVersion(order, request.version());
        requireUnfinished(order, "cancel");
        WorkOrderStatus before = order.getStatus();
        order.setStatus(WorkOrderStatus.CANCELLED);
        order.setCancelledAt(notBefore(now(), order.getCreatedAt()));
        order.setCancelledBy(actor);
        order.setCancelReason(request.reason());
        workOrders.flush();
        record(order, WorkOrderEventType.CANCELLED, before, WorkOrderStatus.CANCELLED, actor, request.reason(), null);
        notice(order, WorkOrderNotice.Kind.CANCELLED, actor);
        return response(id);
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    public WorkOrderResponse linkAlert(UUID id, @Valid LinkAlertRequest request) {
        User actor = actor();
        Alert alert = alerts.findForUpdateById(request.alertId()).orElseThrow(() -> new ResourceNotFoundException("Alert not found"));
        WorkOrder order = lock(id);
        requireUnfinished(order, "link an alert to");
        if (!alert.getMachine().getId().equals(order.getMachineId())) throw new BadRequestException("The alert belongs to another machine");
        if (links.existsById(new WorkOrderAlertId(order.getId(), alert.getId()))) return response(id);
        if (alert.getStatus() == AlertStatus.RESOLVED) throw conflict(ALERT_RESOLVED, "the alert is already resolved");
        requireNotHandled(alert.getId(), order.getId());
        link(order, alert);
        record(order, WorkOrderEventType.UPDATED, order.getStatus(), order.getStatus(), actor, null,
                JsonNodeFactory.instance.objectNode().put("linkedAlertId", alert.getId().toString()));
        return response(id);
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_WORK_ORDER_MANAGE)
    public WorkOrderResponse unlinkAlert(UUID id, UUID alertId) {
        User actor = actor();
        WorkOrder order = lock(id);
        requireUnfinished(order, "unlink an alert from");
        var key = new WorkOrderAlertId(order.getId(), alertId);
        if (!links.existsById(key)) throw new ResourceNotFoundException("The alert is not linked to this work order");
        links.deleteById(key);
        links.flush();
        record(order, WorkOrderEventType.UPDATED, order.getStatus(), order.getStatus(), actor, null,
                JsonNodeFactory.instance.objectNode().put("unlinkedAlertId", alertId.toString()));
        return response(id);
    }

    // ---- execution ----

    /**
     * ASSIGNED -> IN_PROGRESS by the assignee (or a manager). RESTOCK and MAINTENANCE, and INCIDENT with stopMachine, put an ACTIVE
     * machine in MAINTENANCE first; that needs no active order and no unfinished dispense command. Starting again is a no-op.
     */
    @Transactional
    @PreAuthorize(Permissions.HAS_WORK_ORDER_EXECUTE)
    public WorkOrderResponse start(UUID id, StartWorkOrderRequest request) {
        User actor = actor();
        UUID machineId = workOrders.findMachineIdById(id).orElseThrow(WorkOrderService::missing);
        // Machine before WorkOrder, the same order as order creation (which reads the machine with a share lock).
        machineLock.acquire(machineId);
        Machine machine = machines.findForUpdateById(machineId).orElseThrow();
        WorkOrder order = lock(id);
        requireExecutor(order, actor);
        if (order.getStatus() == WorkOrderStatus.IN_PROGRESS) return response(id);
        if (order.getStatus() != WorkOrderStatus.ASSIGNED) throw transition(order, "start");
        if (machine.getStatus() == MachineStatus.INACTIVE) throw conflict(MACHINE_INACTIVE, "the machine is INACTIVE");
        boolean stop = order.getType() != WorkOrderType.INCIDENT || (request != null && Boolean.TRUE.equals(request.stopMachine()));
        boolean stopped = false;
        if (stop && machine.getStatus() == MachineStatus.ACTIVE) {
            if (orders.existsByMachineIdAndStatusIn(machineId, ACTIVE_ORDERS))
                throw conflict(MACHINE_HAS_ACTIVE_ORDERS, "a customer order is still open on this machine; retry within the reservation time (5 min)");
            if (dispenseCommands.existsByMachineIdAndStatusIn(machineId, OPEN_DISPENSE))
                throw conflict(MACHINE_COMMAND_IN_PROGRESS, "a dispense command of this machine is not finished");
            stopped = machineService.enterMaintenanceBySystem(machineId, "WORK_ORDER " + order.getCode());
        }
        order.setStatus(WorkOrderStatus.IN_PROGRESS);
        order.setStartedAt(notBefore(now(), order.getCreatedAt()));
        workOrders.flush();
        record(order, WorkOrderEventType.STARTED, WorkOrderStatus.ASSIGNED, WorkOrderStatus.IN_PROGRESS, actor, null,
                JsonNodeFactory.instance.objectNode().put("machineStopped", stopped).put("machineStatus", machine.getStatus().name()));
        return response(id);
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_WORK_ORDER_EXECUTE)
    public WorkOrderResponse addNote(UUID id, @Valid WorkOrderNoteRequest request) {
        User actor = actor();
        WorkOrder order = lock(id);
        requireExecutor(order, actor);
        requireUnfinished(order, "add a note to");
        record(order, WorkOrderEventType.NOTE, order.getStatus(), order.getStatus(), actor, request.note(), null);
        return response(id);
    }

    /** IN_PROGRESS -> DONE with a result; no maintenance command may still run; linked alerts are resolved unless asked not to. */
    @Transactional
    @PreAuthorize(Permissions.HAS_WORK_ORDER_EXECUTE)
    public WorkOrderResponse complete(UUID id, @Valid CompleteWorkOrderRequest request) {
        User actor = actor();
        WorkOrder order = lock(id);
        requireExecutor(order, actor);
        if (order.getStatus() != WorkOrderStatus.IN_PROGRESS) throw transition(order, "complete");
        if (maintenanceCommands.existsByMachineIdAndStatusIn(order.getMachineId(), MaintenanceCommandStatus.UNFINISHED))
            throw conflict(MACHINE_COMMAND_IN_PROGRESS, "a maintenance command of this machine is not finished");
        for (WorkOrderCompletionCheck check : completionChecks) if (check.supports(order.getType())) check.check(order);
        Instant now = now();
        List<String> resolved = new ArrayList<>();
        if (request.resolveLinkedAlerts() == null || request.resolveLinkedAlerts()) {
            for (UUID alertId : links.findAlertIds(order.getId()).stream().sorted().toList()) {
                Alert alert = alerts.findForUpdateById(alertId).orElseThrow();
                if (alert.getStatus() == AlertStatus.RESOLVED) continue;
                alert.setStatus(AlertStatus.RESOLVED);
                alert.setResolvedAt(notBefore(now, alert.getTriggeredAt()));
                alert.setResolvedBy(actor);
                alert.setResolutionNote("Resolved by " + order.getCode());
                resolved.add(alertId.toString());
            }
            alerts.flush();
        }
        order.setStatus(WorkOrderStatus.DONE);
        order.setCompletedAt(notBefore(now, order.getStartedAt()));
        order.setCompletedBy(actor);
        order.setResultNote(request.resultNote());
        workOrders.flush();
        ObjectNode details = JsonNodeFactory.instance.objectNode();
        details.set("resolvedAlertIds", json.valueToTree(resolved));
        record(order, WorkOrderEventType.COMPLETED, WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.DONE, actor, request.resultNote(), details);
        notice(order, WorkOrderNotice.Kind.COMPLETED, actor);
        return response(id);
    }

    // ---- overdue ----

    @Transactional(readOnly = true)
    public List<UUID> overdueIds(Instant now, int limit) {
        return workOrders.findOverdueIds(now, WorkOrderStatus.UNFINISHED, PageRequest.of(0, limit));
    }

    /** Once per due time: the assignee (or the managers when unassigned) is told, an OVERDUE event is written. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean markOverdue(UUID id, Instant now) {
        WorkOrder order = workOrders.findForUpdateById(id).orElse(null);
        if (order == null || order.getStatus().finished() || order.getOverdueNotifiedAt() != null || order.getDueAt() == null
                || !order.getDueAt().isBefore(now)) return false;
        order.setOverdueNotifiedAt(now);
        workOrders.flush();
        record(order, WorkOrderEventType.OVERDUE, order.getStatus(), order.getStatus(), null, null,
                JsonNodeFactory.instance.objectNode().put("dueAt", order.getDueAt().toString()));
        notice(order, WorkOrderNotice.Kind.OVERDUE, null);
        return true;
    }

    // ---- reads ----

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_WORK_ORDER_READ_ALL)
    public WorkOrderPageResponse list(List<WorkOrderStatus> statuses, WorkOrderType type, WorkOrderSource source, UUID machineId, UUID assigneeId,
            WorkOrderPriority priority, boolean overdue, Instant from, Instant to, int page, int size) {
        return search(statuses, type, source, machineId, assigneeId, priority, overdue, from, to, page, size);
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_WORK_ORDER_READ_ASSIGNED)
    public WorkOrderPageResponse mine(List<WorkOrderStatus> statuses, boolean overdue, int page, int size) {
        return search(statuses, null, null, null, actorId(), null, overdue, null, null, page, size);
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_WORK_ORDER_READ_ASSIGNED)
    public WorkOrderResponse get(UUID id) {
        WorkOrder order = workOrders.findDetailsById(id).orElseThrow(WorkOrderService::missing);
        requireVisible(order);
        return toResponses(List.of(order)).getFirst();
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_WORK_ORDER_READ_ASSIGNED)
    public List<WorkOrderEventResponse> events(UUID id) {
        WorkOrder order = workOrders.findDetailsById(id).orElseThrow(WorkOrderService::missing);
        requireVisible(order);
        return history.findByWorkOrder(id).stream().map(e -> new WorkOrderEventResponse(e.getId(), e.getType(), e.getStatusBefore(), e.getStatusAfter(),
                user(e.getActor()), e.getNote(), e.getDetails() == null ? null : json.convertValue(e.getDetails(), Map.class), e.getCreatedAt())).toList();
    }

    private WorkOrderPageResponse search(List<WorkOrderStatus> statuses, WorkOrderType type, WorkOrderSource source, UUID machineId, UUID assigneeId,
            WorkOrderPriority priority, boolean overdue, Instant from, Instant to, int page, int size) {
        TimeRange.checkPage(page, size, MAX_PAGE_SIZE);
        TimeRange range = TimeRange.of(from, to);
        Collection<WorkOrderStatus> wanted = statuses == null || statuses.isEmpty() ? EnumSet.allOf(WorkOrderStatus.class) : EnumSet.copyOf(statuses);
        var result = workOrders.search(wanted, type, source, machineId, assigneeId, priority, overdue, now(), WorkOrderStatus.UNFINISHED,
                range.from(), range.to(), PageRequest.of(page, size));
        return new WorkOrderPageResponse(toResponses(result.getContent()), page, size, result.getTotalElements(), result.getTotalPages());
    }

    // ---- helpers ----

    private WorkOrderResponse response(UUID id) {
        return toResponses(List.of(workOrders.findDetailsById(id).orElseThrow())).getFirst();
    }

    private List<WorkOrderResponse> toResponses(List<WorkOrder> page) {
        if (page.isEmpty()) return List.of();
        Map<UUID, List<WorkOrderResponse.WorkOrderLinkedAlert>> linked = links.findLinkedAlerts(page.stream().map(WorkOrder::getId).toList()).stream()
                .collect(Collectors.groupingBy(WorkOrderAlertRepository.LinkedAlert::getWorkOrderId, LinkedHashMap::new,
                        Collectors.mapping(l -> new WorkOrderResponse.WorkOrderLinkedAlert(l.getAlertId(), AlertType.valueOf(l.getType()),
                                AlertSeverity.valueOf(l.getSeverity()), AlertStatus.valueOf(l.getStatus()), l.getTitle()), Collectors.toList())));
        Instant now = now();
        return page.stream().map(w -> new WorkOrderResponse(w.getId(), w.getCode(), w.getType(), w.getSource(), w.getMachineId(), w.getMachine().getCode(),
                w.getMachine().getName(), w.getTitle(), w.getDescription(), w.getPriority(), w.getStatus(), user(w.getAssignee()), user(w.getCreatedBy()),
                w.getDueAt(), w.getDueAt() != null && !w.getStatus().finished() && w.getDueAt().isBefore(now), w.getStartedAt(), w.getCompletedAt(),
                user(w.getCompletedBy()), w.getResultNote(), w.getCancelledAt(), user(w.getCancelledBy()), w.getCancelReason(),
                linked.getOrDefault(w.getId(), List.of()), w.getVersion(), w.getCreatedAt(), w.getUpdatedAt())).toList();
    }

    private static WorkOrderResponse.WorkOrderUser user(User user) {
        return user == null ? null : new WorkOrderResponse.WorkOrderUser(user.getId(), user.getFullName());
    }

    private WorkOrder lock(UUID id) {
        WorkOrder order = workOrders.findForUpdateById(id).orElseThrow(WorkOrderService::missing);
        requireVisible(order);
        return order;
    }

    /** Without READ_ALL a work order assigned to someone else does not exist for the caller. */
    private void requireVisible(WorkOrder order) {
        if (has(Permissions.WORK_ORDER_READ_ALL)) return;
        if (order.getAssignee() == null || !order.getAssignee().getId().equals(actorId())) throw missing();
    }

    /** The assignee executes; managers (Admin) may act for them. */
    private void requireExecutor(WorkOrder order, User actor) {
        boolean assignee = order.getAssignee() != null && order.getAssignee().getId().equals(actor.getId());
        if (!assignee && !has(Permissions.WORK_ORDER_MANAGE)) throw missing();
    }

    private static void requireVersion(WorkOrder order, Long version) {
        if (!order.getVersion().equals(version)) throw conflict(STALE_VERSION, "the work order was changed meanwhile; reload it and try again");
    }

    private static void requireUnfinished(WorkOrder order, String action) {
        if (order.getStatus().finished()) throw transition(order, action);
    }

    private void requireNotHandled(UUID alertId, UUID except) {
        for (var active : links.findActiveLinks(List.of(alertId))) {
            if (except != null && active.getWorkOrderId().equals(except)) continue;
            throw conflict(ALERT_ALREADY_HANDLED, "the alert is handled by work order " + active.getCode() + " (" + active.getWorkOrderId() + ")");
        }
    }

    private void link(WorkOrder order, Alert alert) {
        links.saveAndFlush(new WorkOrderAlert(new WorkOrderAlertId(order.getId(), alert.getId())));
    }

    private User assignee(UUID userId) {
        if (!workOrders.canExecute(userId)) throw new BadRequestException("assigneeId must be an ACTIVE user holding WORK_ORDER_EXECUTE");
        return users.getReferenceById(userId);
    }

    private static void requireFuture(Instant dueAt, Instant now) {
        if (dueAt != null && dueAt.isBefore(now)) throw new BadRequestException("dueAt must not be in the past");
    }

    private void record(WorkOrder order, WorkOrderEventType type, WorkOrderStatus before, WorkOrderStatus after, User actor, String note, JsonNode details) {
        var event = new WorkOrderEvent();
        event.setWorkOrderId(order.getId());
        event.setType(type);
        event.setStatusBefore(before);
        event.setStatusAfter(after);
        event.setActor(actor);
        event.setNote(note);
        event.setDetails(details);
        history.save(event);
        history.flush();
    }

    private void notice(WorkOrder order, WorkOrderNotice.Kind kind, User actor) {
        events.publishEvent(new WorkOrderNotice(order.getId(), kind, actor == null ? null : actor.getId()));
    }

    private static void change(ObjectNode changes, String field, String from, String to) {
        if (Objects.equals(from, to)) return;
        changes.set(field, JsonNodeFactory.instance.objectNode().put("from", from).put("to", to));
    }

    private String newCode() {
        for (int attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
            String code = codes.generate();
            if (!workOrders.existsByCode(code)) return code;
        }
        throw new ConflictException("Could not allocate a unique work order code");
    }

    private User actor() {
        return users.findById(actorId()).orElseThrow(() -> new ResourceNotFoundException("Actor not found"));
    }

    private static UUID actorId() {
        return ((AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal()).getId();
    }

    private static boolean has(String authority) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null && authentication.getAuthorities().stream().map(GrantedAuthority::getAuthority).anyMatch(authority::equals);
    }

    private static ConflictException transition(WorkOrder order, String action) {
        return conflict(INVALID_TRANSITION, "cannot " + action + " a " + order.getStatus() + " work order");
    }

    private static ConflictException conflict(String code, String message) {
        return new ConflictException(code + ": " + message);
    }

    private static ResourceNotFoundException missing() {
        return new ResourceNotFoundException("Work order not found");
    }

    private static String truncate(String text, int max) {
        return text == null ? null : text.length() > max ? text.substring(0, max) : text;
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }

    private static Instant notBefore(Instant candidate, Instant floor) {
        return floor != null && candidate.isBefore(floor) ? floor : candidate;
    }
}
