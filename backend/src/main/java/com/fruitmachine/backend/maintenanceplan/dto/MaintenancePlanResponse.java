package com.fruitmachine.backend.maintenanceplan.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fruitmachine.backend.workorder.enums.WorkOrderPriority;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

@Schema(description = "A maintenance plan. Dates are business-zone dates; dueTime is a local time there.")
public record MaintenancePlanResponse(UUID id, UUID machineId, String machineCode, String machineName, String title,
        @Schema(nullable = true) String instructions, int intervalDays, int leadDays,
        @JsonFormat(pattern = "HH:mm") @Schema(type = "string", example = "17:00") LocalTime dueTime,
        WorkOrderPriority priority,
        @Schema(nullable = true) PlanUser defaultAssignee,
        LocalDate nextDueDate, boolean active,
        @Schema(description = "next due date passed and no unfinished work order.") boolean overdue,
        @Schema(nullable = true, description = "The unfinished work order of the plan, if any.") PlanWorkOrder currentWorkOrder,
        @Schema(nullable = true) Instant lastCompletedAt,
        PlanUser createdBy, long version, Instant createdAt, Instant updatedAt) {

    public record PlanUser(UUID id, String fullName) { }

    public record PlanWorkOrder(UUID id, String code, String status) { }
}
