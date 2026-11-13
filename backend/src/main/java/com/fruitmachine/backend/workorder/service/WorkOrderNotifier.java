package com.fruitmachine.backend.workorder.service;

import com.fruitmachine.backend.alert.enums.AlertSeverity;
import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.notification.entity.Notification;
import com.fruitmachine.backend.notification.repository.NotificationRepository;
import com.fruitmachine.backend.user.repository.UserRepository;
import com.fruitmachine.backend.workorder.entity.WorkOrder;
import com.fruitmachine.backend.workorder.event.WorkOrderNotice;
import com.fruitmachine.backend.workorder.repository.WorkOrderRepository;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Portal notifications about work orders (issue #66), written after the work order committed in a transaction of their own: a
 * failure is logged and never undoes the work order. Texts are Vietnamese UI text; times are business-zone local times.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WorkOrderNotifier {
    private final WorkOrderRepository workOrders;
    private final NotificationRepository notifications;
    private final UserRepository users;
    private final BusinessCalendar calendar;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void on(WorkOrderNotice notice) {
        try {
            send(notice);
        } catch (RuntimeException ex) {
            log.error("Notification {} for work order {} could not be created", notice.kind(), notice.workOrderId(), ex);
        }
    }

    void send(WorkOrderNotice notice) {
        WorkOrder order = workOrders.findDetailsById(notice.workOrderId()).orElse(null);
        if (order == null) return;
        Set<UUID> recipients = new LinkedHashSet<>();
        String title;
        String message;
        AlertSeverity severity = order.getPriority().severity();
        String machine = order.getMachine().getCode();
        switch (notice.kind()) {
            case ASSIGNED -> {
                if (order.getAssignee() != null) recipients.add(order.getAssignee().getId());
                title = "Bạn được giao " + order.getCode();
                message = order.getType() + ", máy " + machine + ", hạn " + due(order) + ": " + order.getTitle();
            }
            case SYSTEM_CREATED -> {
                recipients.addAll(workOrders.findManagerIds());
                title = "Công việc mới " + order.getCode() + " chưa được giao";
                message = order.getType() + " (" + order.getSource() + "), máy " + machine + ": " + order.getTitle();
            }
            case COMPLETED -> {
                addParticipants(order, recipients);
                title = order.getCode() + " đã hoàn thành";
                message = "Máy " + machine + ": " + order.getResultNote();
                severity = AlertSeverity.INFO;
            }
            case CANCELLED -> {
                addParticipants(order, recipients);
                title = order.getCode() + " đã bị hủy";
                message = "Máy " + machine + ": " + order.getCancelReason();
                severity = AlertSeverity.INFO;
            }
            case OVERDUE -> {
                if (order.getAssignee() != null) recipients.add(order.getAssignee().getId());
                else recipients.addAll(workOrders.findManagerIds());
                title = order.getCode() + " đã quá hạn";
                message = order.getType() + ", máy " + machine + ", hạn " + due(order) + ": " + order.getTitle();
                if (severity == AlertSeverity.INFO) severity = AlertSeverity.WARNING;
            }
            default -> throw new IllegalStateException("Unknown notice " + notice.kind());
        }
        // The person who acted does not need to be told what they just did.
        if (notice.actorId() != null) recipients.remove(notice.actorId());
        for (UUID userId : recipients) {
            var row = new Notification();
            row.setUser(users.getReferenceById(userId));
            row.setWorkOrderId(order.getId());
            row.setTitle(truncate(title, 255));
            row.setMessage(truncate(message, 1000));
            row.setSeverity(severity);
            notifications.save(row);
        }
        notifications.flush();
    }

    private static void addParticipants(WorkOrder order, Set<UUID> recipients) {
        if (order.getCreatedBy() != null) recipients.add(order.getCreatedBy().getId());
        if (order.getAssignee() != null) recipients.add(order.getAssignee().getId());
    }

    private String due(WorkOrder order) {
        return order.getDueAt() == null ? "không có" : DateTimeFormatter.ofPattern("HH:mm dd/MM/yyyy").withZone(calendar.zone()).format(order.getDueAt());
    }

    private static String truncate(String text, int max) {
        return text == null ? null : text.length() > max ? text.substring(0, max) : text;
    }
}
