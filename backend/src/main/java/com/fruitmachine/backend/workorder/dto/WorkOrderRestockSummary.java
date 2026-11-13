package com.fruitmachine.backend.workorder.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Issue #68: totals of a RESTOCK work order's lines.")
public record WorkOrderRestockSummary(int lines, int plannedTotal, int loadedTotal,
        @Schema(description = "Lines whose loaded quantity differs from the planned one.") int varianceLines) {
}
