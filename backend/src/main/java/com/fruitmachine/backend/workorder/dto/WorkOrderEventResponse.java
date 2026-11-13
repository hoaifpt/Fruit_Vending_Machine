package com.fruitmachine.backend.workorder.dto;

import com.fruitmachine.backend.workorder.enums.WorkOrderEventType;
import com.fruitmachine.backend.workorder.enums.WorkOrderStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Schema(description = "One history row of a work order (append-only).")
public record WorkOrderEventResponse(
        UUID id, WorkOrderEventType type,
        @Schema(nullable = true) WorkOrderStatus statusBefore,
        @Schema(nullable = true) WorkOrderStatus statusAfter,
        @Schema(nullable = true, description = "null = the system.") WorkOrderResponse.WorkOrderUser actor,
        @Schema(nullable = true) String note,
        @Schema(nullable = true, description = "Changed fields, assignees, linked alerts, machine stop; keys depend on type.") Map<String, Object> details,
        Instant createdAt) {
}
