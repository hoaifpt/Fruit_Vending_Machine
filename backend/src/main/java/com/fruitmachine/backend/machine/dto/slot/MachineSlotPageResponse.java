package com.fruitmachine.backend.machine.dto.slot;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "Database-paginated slots belonging to one machine, optionally filtered by status.")
public record MachineSlotPageResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<MachineSlotResponse> content,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0", description = "Zero-based page index.") int page,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "1", maximum = "100", description = "Requested page size.") int size,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0", description = "Total matching slots in the specified machine.") long totalElements,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0", description = "Total pages.") int totalPages) {}
