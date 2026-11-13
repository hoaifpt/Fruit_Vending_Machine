package com.fruitmachine.backend.notification.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "Database page of the signed-in user's notifications, newest first.")
public record NotificationPageResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Notifications of this page.") List<NotificationResponse> content,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Zero-based page index.") int page,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Requested page size.") int size,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Matching notifications.") long totalElements,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Pages of matching notifications.") int totalPages) { }
