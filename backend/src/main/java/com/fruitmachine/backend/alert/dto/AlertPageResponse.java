package com.fruitmachine.backend.alert.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "Database page of alerts: CRITICAL first, then WARNING, then INFO; newest first within a severity (then id DESC).")
public record AlertPageResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Alerts of this page.") List<AlertResponse> content,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Zero-based page index.") int page,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Requested page size.") int size,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Matching alerts.") long totalElements,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Pages of matching alerts.") int totalPages) { }
