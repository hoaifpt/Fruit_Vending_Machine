package com.fruitmachine.backend.maintenanceplan.listener;

import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.maintenanceplan.entity.MaintenancePlan;
import com.fruitmachine.backend.maintenanceplan.repository.MaintenancePlanRepository;
import com.fruitmachine.backend.workorder.entity.WorkOrder;
import com.fruitmachine.backend.workorder.event.WorkOrderCancelledEvent;
import com.fruitmachine.backend.workorder.event.WorkOrderCompletedEvent;
import com.fruitmachine.backend.workorder.repository.WorkOrderRepository;
import java.time.LocalDate;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Next due date (issue #70 §4), after the work order committed, in a transaction of its own; never throws into the work order flow.
 * Completed: completion date (business zone) + interval, last_completed_at set. Cancelled: the occurrence is skipped (scheduled_for +
 * interval). A later date the Admin already set is kept. Deactivated plans are updated too (history stays consistent).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MaintenancePlanWorkOrderListener {
    private final WorkOrderRepository workOrders;
    private final MaintenancePlanRepository plans;
    private final BusinessCalendar calendar;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void onCompleted(WorkOrderCompletedEvent event) {
        try {
            WorkOrder order = workOrders.findById(event.workOrderId()).orElse(null);
            if (order == null || order.getMaintenancePlanId() == null || order.getCompletedAt() == null) return;
            MaintenancePlan plan = plans.findForUpdateById(order.getMaintenancePlanId()).orElseThrow();
            plan.setLastCompletedAt(order.getCompletedAt());
            advance(plan, calendar.dayOf(order.getCompletedAt()).plusDays(plan.getIntervalDays()));
        } catch (RuntimeException ex) {
            log.error("Next due date after work order {} could not be computed", event.workOrderId(), ex);
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void onCancelled(WorkOrderCancelledEvent event) {
        try {
            WorkOrder order = workOrders.findById(event.workOrderId()).orElse(null);
            if (order == null || order.getMaintenancePlanId() == null || order.getScheduledFor() == null) return;
            MaintenancePlan plan = plans.findForUpdateById(order.getMaintenancePlanId()).orElseThrow();
            advance(plan, order.getScheduledFor().plusDays(plan.getIntervalDays()));
        } catch (RuntimeException ex) {
            log.error("Next due date after cancelled work order {} could not be computed", event.workOrderId(), ex);
        }
    }

    private void advance(MaintenancePlan plan, LocalDate computed) {
        if (computed.isAfter(plan.getNextDueDate())) plan.setNextDueDate(computed);
        plans.flush();
    }
}
