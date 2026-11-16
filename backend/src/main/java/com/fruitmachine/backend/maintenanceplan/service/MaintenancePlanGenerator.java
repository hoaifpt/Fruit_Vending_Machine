package com.fruitmachine.backend.maintenanceplan.service;

import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.maintenanceplan.entity.MaintenancePlan;
import com.fruitmachine.backend.maintenanceplan.repository.MaintenancePlanRepository;
import com.fruitmachine.backend.workorder.entity.WorkOrder;
import com.fruitmachine.backend.workorder.enums.WorkOrderStatus;
import com.fruitmachine.backend.workorder.repository.WorkOrderRepository;
import com.fruitmachine.backend.workorder.service.WorkOrderService;
import java.time.LocalDate;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Creates the work order of one plan occurrence (issue #70 §3) under the plan's row lock: MAINTENANCE, source SCHEDULE, due at the
 * plan's due time on next_due_date (business zone), assigned to the default assignee while that user may still execute work orders.
 * Missed runs never flood: only the current next_due_date gets a work order (its due time may already be past: 4.3 overdue fires).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MaintenancePlanGenerator {
    public static final String PLAN_INACTIVE = "MAINTENANCE_PLAN_INACTIVE";
    public static final String PLAN_HAS_OPEN_WORK_ORDER = "PLAN_HAS_OPEN_WORK_ORDER";
    public static final String MACHINE_INACTIVE = "MACHINE_INACTIVE";
    public static final String OCCURRENCE_EXISTS = "OCCURRENCE_ALREADY_GENERATED";

    public enum Result { CREATED, NOT_DUE, SKIPPED }

    private final MaintenancePlanRepository plans;
    private final WorkOrderRepository workOrders;
    private final WorkOrderService workOrderService;
    private final MachineRepository machines;
    private final BusinessCalendar calendar;

    /** Scheduler step for one plan, in its own transaction; a plan that is not (or no longer) due is skipped silently. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Result generateIfDue(UUID planId, LocalDate today) {
        MaintenancePlan plan = plans.findForUpdateById(planId).orElse(null);
        if (plan == null || !plan.isActive()) return Result.SKIPPED;
        if (!isDue(plan.getNextDueDate(), plan.getLeadDays(), today)) return Result.NOT_DUE;
        if (blocked(plan) != null) return Result.SKIPPED;
        create(plan);
        return Result.CREATED;
    }

    /** generate-now: the current occurrence regardless of lead days; the caller's transaction; refusals are 409. */
    @Transactional(propagation = Propagation.MANDATORY)
    public WorkOrder generateNow(MaintenancePlan plan) {
        if (!plan.isActive()) throw new ConflictException(PLAN_INACTIVE + ": activate the plan first");
        String reason = blocked(plan);
        if (reason != null) throw new ConflictException(reason);
        return create(plan);
    }

    /** The occurrence on {@code nextDue} is generated from {@code nextDue - leadDays} on (business-zone dates). */
    public static boolean isDue(LocalDate nextDue, int leadDays, LocalDate today) {
        return !nextDue.minusDays(leadDays).isAfter(today);
    }

    /** When the occurrence's work order is due: {@code dueTime} on {@code date} in the business zone. */
    public static java.time.Instant dueAt(LocalDate date, java.time.LocalTime dueTime, java.time.ZoneId zone) {
        return date.atTime(dueTime).atZone(zone).toInstant();
    }

    private String blocked(MaintenancePlan plan) {
        if (machines.findById(plan.getMachineId()).map(m -> m.getStatus() == MachineStatus.INACTIVE).orElse(true))
            return MACHINE_INACTIVE + ": the machine is INACTIVE";
        if (workOrders.existsByMaintenancePlanIdAndStatusIn(plan.getId(), WorkOrderStatus.UNFINISHED))
            return PLAN_HAS_OPEN_WORK_ORDER + ": the plan's previous work order is not finished";
        if (workOrders.existsByMaintenancePlanIdAndScheduledFor(plan.getId(), plan.getNextDueDate()))
            return OCCURRENCE_EXISTS + ": the occurrence of " + plan.getNextDueDate() + " already has a work order";
        return null;
    }

    private WorkOrder create(MaintenancePlan plan) {
        var dueAt = dueAt(plan.getNextDueDate(), plan.getDueTime(), calendar.zone());
        WorkOrder order = workOrderService.createScheduled(plan.getId(), plan.getNextDueDate(), plan.getMachineId(), plan.getTitle(), plan.getInstructions(),
                plan.getPriority(), dueAt, plan.getDefaultAssignee() == null ? null : plan.getDefaultAssignee().getId());
        log.info("Maintenance plan {} generated work order {} for {}", plan.getId(), order.getCode(), plan.getNextDueDate());
        return order;
    }
}
