package com.fruitmachine.backend.machine.dto.event;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "Database page of machine events, newest first (createdAt DESC, then id DESC).")
public record MachineEventPageResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Events of this page.") List<MachineEventResponse> content,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Zero-based page index.") int page,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Requested page size.") int size,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Matching events.") long totalElements,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Pages of matching events.") int totalPages) { }
