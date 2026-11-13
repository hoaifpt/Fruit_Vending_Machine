package com.fruitmachine.backend.workorder.dto;

import com.fruitmachine.backend.alert.enums.AlertSeverity;
import com.fruitmachine.backend.alert.enums.AlertStatus;
import com.fruitmachine.backend.alert.enums.AlertType;
import com.fruitmachine.backend.workorder.enums.WorkOrderPriority;
import com.fruitmachine.backend.workorder.enums.WorkOrderSource;
import com.fruitmachine.backend.workorder.enums.WorkOrderStatus;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Schema(description = "A work order. version is sent back on edit, assign, unassign and cancel.")
public record WorkOrderResponse(
        UUID id,
        @Schema(example = "WO-20261113-K7QF") String code,
        WorkOrderType type, WorkOrderSource source,
        UUID machineId, String machineCode, String machineName,
        String title,
        @Schema(nullable = true) String description,
        WorkOrderPriority priority, WorkOrderStatus status,
        @Schema(nullable = true) WorkOrderUser assignee,
        @Schema(nullable = true, description = "null = created by the system.") WorkOrderUser createdBy,
        @Schema(nullable = true) Instant dueAt,
        @Schema(description = "Due time passed while unfinished.") boolean overdue,
        @Schema(nullable = true) Instant startedAt,
        @Schema(nullable = true) Instant completedAt,
        @Schema(nullable = true) WorkOrderUser completedBy,
        @Schema(nullable = true) String resultNote,
        @Schema(nullable = true) Instant cancelledAt,
        @Schema(nullable = true) WorkOrderUser cancelledBy,
        @Schema(nullable = true) String cancelReason,
        List<WorkOrderLinkedAlert> linkedAlerts,
        @Schema(nullable = true, description = "Issue #68: RESTOCK work orders only.") WorkOrderRestockSummary restockSummary,
        @Schema(nullable = true, description = "Issue #70: the maintenance plan of a SCHEDULE work order.") WorkOrderPlan maintenancePlan,
        @Schema(nullable = true, description = "Issue #70: the plan occurrence (business-zone date) of a SCHEDULE work order.") java.time.LocalDate scheduledFor,
        long version, Instant createdAt, Instant updatedAt) {

    public record WorkOrderUser(UUID id, String fullName) { }

    public record WorkOrderPlan(UUID id, String title) { }

    public record WorkOrderLinkedAlert(UUID id, AlertType type, AlertSeverity severity, AlertStatus status, String title) { }
}
