package com.fruitmachine.backend.sensor.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "Database page of telemetry readings, newest first (recordedAt DESC, then id DESC).")
public record TelemetryPageResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Readings of this page.") List<TelemetryReadingResponse> content,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Zero-based page index.") int page,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Requested page size.") int size,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Readings in the time range.") long totalElements,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Pages in the time range.") int totalPages) { }
