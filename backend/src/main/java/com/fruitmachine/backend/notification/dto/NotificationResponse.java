package com.fruitmachine.backend.notification.dto;

import com.fruitmachine.backend.alert.enums.AlertSeverity;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "One portal notification of the signed-in user.")
public record NotificationResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Notification UUID.") UUID id,
        @Schema(description = "Alert that caused it; open it with GET /api/v1/alerts/{id} (needs ALERT_READ).", types = {"string", "null"}, format = "uuid") UUID alertId,
        @Schema(description = "Issue #66: work order it is about; open it with GET /api/v1/work-orders/{id}.", types = {"string", "null"}, format = "uuid") UUID workOrderId,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Title (copied from the alert or the work order).") String title,
        @Schema(description = "Message (copied from the alert).", types = {"string", "null"}) String message,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "INFO, WARNING or CRITICAL.") AlertSeverity severity,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "True once read.") boolean read,
        @Schema(description = "When it was marked read, UTC; null while unread.", types = {"string", "null"}, format = "date-time") Instant readAt,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Creation instant, UTC.") Instant createdAt) { }
