package com.fruitmachine.backend.machine.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "Database-paginated machines matching combined status/search filters.")
public record MachinePageResponse(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<MachineResponse> content,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0", description = "Zero-based page index.") int page,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "1", maximum = "100", description = "Requested page size.") int size,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0", description = "Total matching machines.") long totalElements,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0", description = "Total pages.") int totalPages) { }
