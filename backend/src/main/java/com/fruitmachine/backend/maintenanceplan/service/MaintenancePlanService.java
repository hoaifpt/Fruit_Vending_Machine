package com.fruitmachine.backend.maintenanceplan.service;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fruitmachine.backend.audit.entity.AuditLog;
import com.fruitmachine.backend.audit.repository.AuditLogRepository;
import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.common.request.TimeRange;
import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.maintenanceplan.dto.*;
import com.fruitmachine.backend.maintenanceplan.entity.MaintenancePlan;
import com.fruitmachine.backend.maintenanceplan.repository.MaintenancePlanRepository;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.repository.UserRepository;
import com.fruitmachine.backend.workorder.dto.WorkOrderResponse;
import com.fruitmachine.backend.workorder.enums.WorkOrderPriority;
import com.fruitmachine.backend.workorder.repository.WorkOrderRepository;
import com.fruitmachine.backend.workorder.service.WorkOrderService;
import jakarta.persistence.EntityManager;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;

/** Maintenance plans (issue #70 §2): CRUD without delete, every change audited; upcoming view; generate-now. */
@Service
@Validated
@RequiredArgsConstructor
public class MaintenancePlanService {
    public static final String STALE_VERSION = "STALE_VERSION";
    public static final String MACHINE_INACTIVE = "MACHINE_INACTIVE";
    public static final String ENTITY = "MAINTENANCE_PLAN";
    static final int MAX_PAGE_SIZE = 100;

    private final MaintenancePlanRepository plans;
    private final MaintenancePlanGenerator generator;
    private final WorkOrderRepository workOrders;
    private final WorkOrderService workOrderService;
    private final MachineRepository machines;
    private final UserRepository users;
    private final AuditLogRepository audits;
    private final BusinessCalendar calendar;
    private final EntityManager entityManager;

    @Transactional
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_MANAGE)
    public MaintenancePlanResponse create(@Valid CreateMaintenancePlanRequest request) {
        User actor = actor();
        var machine = machines.findById(request.machineId()).orElseThrow(() -> new ResourceNotFoundException("Machine not found"));
        if (machine.getStatus() == MachineStatus.INACTIVE) throw new ConflictException(MACHINE_INACTIVE + ": plans need an ACTIVE or MAINTENANCE machine");
        int lead = request.leadDays() == null ? 0 : request.leadDays();
        requireLead(lead, request.intervalDays());
        LocalDate today = calendar.today();
        LocalDate first = request.firstDueDate() == null ? today.plusDays(request.intervalDays()) : request.firstDueDate();
        if (first.isBefore(today)) throw new BadRequestException("firstDueDate must be today or later (" + today + ", " + calendar.zone().getId() + ")");
        var plan = new MaintenancePlan();
        plan.setMachineId(machine.getId());
        plan.setTitle(request.title());
        plan.setInstructions(request.instructions());
        plan.setIntervalDays(request.intervalDays());
        plan.setLeadDays(lead);
        plan.setDueTime(request.dueTime() == null ? LocalTime.of(17, 0) : request.dueTime().withSecond(0).withNano(0));
        plan.setPriority(request.priority() == null ? WorkOrderPriority.NORMAL : request.priority());
        plan.setDefaultAssignee(request.defaultAssigneeId() == null ? null : assignee(request.defaultAssigneeId()));
        plan.setNextDueDate(first);
        plan.setCreatedBy(actor);
        plans.saveAndFlush(plan);
        entityManager.refresh(plan);
        audit(actor, plan, "MAINTENANCE_PLAN_CREATED", null, snapshot(plan));
        return response(plan.getId());
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_MANAGE)
    public MaintenancePlanResponse update(UUID id, @Valid UpdateMaintenancePlanRequest request) {
        User actor = actor();
        MaintenancePlan plan = lock(id);
        if (!plan.getVersion().equals(request.version())) throw new ConflictException(STALE_VERSION + ": the plan was changed meanwhile; reload it");
        ObjectNode before = snapshot(plan);
        if (request.title() != null) {
            if (request.title().isBlank()) throw new BadRequestException("title must not be blank");
            plan.setTitle(request.title().strip());
        }
        if (request.instructions() != null) plan.setInstructions(request.instructions().isBlank() ? null : request.instructions().strip());
        if (request.intervalDays() != null) plan.setIntervalDays(request.intervalDays());
        if (request.leadDays() != null) plan.setLeadDays(request.leadDays());
        requireLead(plan.getLeadDays(), plan.getIntervalDays());
        if (request.dueTime() != null) plan.setDueTime(request.dueTime().withSecond(0).withNano(0));
        if (request.priority() != null) plan.setPriority(request.priority());
        if (Boolean.TRUE.equals(request.clearDefaultAssignee())) plan.setDefaultAssignee(null);
        else if (request.defaultAssigneeId() != null) plan.setDefaultAssignee(assignee(request.defaultAssigneeId()));
        if (request.nextDueDate() != null) {
            if (request.nextDueDate().isBefore(calendar.today())) throw new BadRequestException("nextDueDate must be today or later");
            plan.setNextDueDate(request.nextDueDate());
        }
        ObjectNode after = snapshot(plan);
        if (after.equals(before)) return response(id);
        plans.flush();
        audit(actor, plan, "MAINTENANCE_PLAN_UPDATED", before, after);
        return response(id);
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_MANAGE)
    public MaintenancePlanResponse setActive(UUID id, boolean active) {
        User actor = actor();
        MaintenancePlan plan = lock(id);
        if (plan.isActive() == active) return response(id);
        ObjectNode before = snapshot(plan);
        plan.setActive(active);
        plans.flush();
        audit(actor, plan, active ? "MAINTENANCE_PLAN_ACTIVATED" : "MAINTENANCE_PLAN_DEACTIVATED", before, snapshot(plan));
        return response(id);
    }

    /** The current occurrence now, regardless of lead days; 409 for an inactive plan or while a work order of the plan is unfinished. */
    @Transactional
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_MANAGE)
    public WorkOrderResponse generateNow(UUID id) {
        MaintenancePlan plan = lock(id);
        var order = generator.generateNow(plan);
        return workOrderService.get(order.getId());
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_READ)
    public MaintenancePlanPageResponse list(UUID machineId, Boolean active, int page, int size) {
        TimeRange.checkPage(page, size, MAX_PAGE_SIZE);
        var result = plans.search(machineId, active, PageRequest.of(page, size));
        return new MaintenancePlanPageResponse(responses(result.getContent()), page, size, result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_READ)
    public MaintenancePlanResponse get(UUID id) {
        return response(id);
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_READ)
    public List<PlanWorkOrderResponse> workOrders(UUID id) {
        plans.findById(id).orElseThrow(MaintenancePlanService::missing);
        return workOrders.findByPlan(id).stream().map(w -> new PlanWorkOrderResponse(w.getId(), w.getCode(), w.getStatus().name(), w.getScheduledFor(),
                w.getDueAt(), w.getAssignee() == null ? null : new MaintenancePlanResponse.PlanUser(w.getAssignee().getId(), w.getAssignee().getFullName()),
                w.getCompletedAt(), w.getCancelledAt())).toList();
    }

    /** Active plans due within {@code days} (1..90; overdue ones included), with their unfinished work orders, by date. */
    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_MAINTENANCE_PLAN_READ)
    public List<MaintenancePlanResponse> upcoming(int days, UUID machineId) {
        if (days < 1 || days > 90) throw new BadRequestException("days must be between 1 and 90");
        return responses(plans.findUpcoming(calendar.today().plusDays(days), machineId));
    }

    // ---- helpers ----

    private MaintenancePlanResponse response(UUID id) {
        return responses(List.of(plans.findDetailsById(id).orElseThrow(MaintenancePlanService::missing))).getFirst();
    }

    private List<MaintenancePlanResponse> responses(List<MaintenancePlan> page) {
        if (page.isEmpty()) return List.of();
        Map<UUID, WorkOrderRepository.PlanWorkOrder> open = workOrders.findUnfinishedByPlanIds(page.stream().map(MaintenancePlan::getId).toList()).stream()
                .collect(Collectors.toMap(WorkOrderRepository.PlanWorkOrder::getPlanId, Function.identity(), (a, b) -> a));
        LocalDate today = calendar.today();
        return page.stream().map(p -> {
            var current = open.get(p.getId());
            return new MaintenancePlanResponse(p.getId(), p.getMachineId(), p.getMachine().getCode(), p.getMachine().getName(), p.getTitle(),
                    p.getInstructions(), p.getIntervalDays(), p.getLeadDays(), p.getDueTime(), p.getPriority(), user(p.getDefaultAssignee()),
                    p.getNextDueDate(), p.isActive(), p.getNextDueDate().isBefore(today) && current == null,
                    current == null ? null : new MaintenancePlanResponse.PlanWorkOrder(current.getId(), current.getCode(), current.getStatus()),
                    p.getLastCompletedAt(), user(p.getCreatedBy()), p.getVersion(), p.getCreatedAt(), p.getUpdatedAt());
        }).toList();
    }

    private static MaintenancePlanResponse.PlanUser user(User user) {
        return user == null ? null : new MaintenancePlanResponse.PlanUser(user.getId(), user.getFullName());
    }

    private MaintenancePlan lock(UUID id) {
        return plans.findForUpdateById(id).orElseThrow(MaintenancePlanService::missing);
    }

    private static void requireLead(int lead, int interval) {
        if (lead >= interval) throw new BadRequestException("leadDays must be smaller than intervalDays");
    }

    private User assignee(UUID userId) {
        if (!workOrders.canExecute(userId)) throw new BadRequestException("defaultAssigneeId must be an ACTIVE user holding WORK_ORDER_EXECUTE");
        return users.getReferenceById(userId);
    }

    private static ObjectNode snapshot(MaintenancePlan plan) {
        return JsonNodeFactory.instance.objectNode().put("title", plan.getTitle()).put("instructions", plan.getInstructions())
                .put("intervalDays", plan.getIntervalDays()).put("leadDays", plan.getLeadDays()).put("dueTime", plan.getDueTime().toString())
                .put("priority", plan.getPriority().name())
                .put("defaultAssigneeId", plan.getDefaultAssignee() == null ? null : plan.getDefaultAssignee().getId().toString())
                .put("nextDueDate", plan.getNextDueDate().toString()).put("active", plan.isActive());
    }

    private void audit(User actor, MaintenancePlan plan, String action, ObjectNode before, ObjectNode after) {
        var row = new AuditLog();
        row.setUser(actor);
        row.setAction(action);
        row.setEntityType(ENTITY);
        row.setEntityId(plan.getId());
        row.setOldValue(before);
        row.setNewValue(after);
        audits.save(row);
    }

    private User actor() {
        UUID id = ((AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal()).getId();
        return users.findById(id).orElseThrow(() -> new ResourceNotFoundException("Actor not found"));
    }

    private static ResourceNotFoundException missing() {
        return new ResourceNotFoundException("Maintenance plan not found");
    }
}
