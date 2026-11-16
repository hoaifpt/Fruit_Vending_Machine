package com.fruitmachine.backend.restock.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Schema(description = "A RESTOCK work order: lines with loads, linked maintenance commands and the bowls they removed.")
public record RestockViewResponse(UUID workOrderId, String workOrderCode, String status, List<RestockLineResponse> lines,
        int plannedTotal, int loadedTotal, List<LinkedMaintenanceCommand> maintenanceCommands,
        @Schema(description = "Bowls removed by completed (or reconciled DONE) linked maintenance commands, by reason.") Map<String, Integer> removedByReason) {

    public record LinkedMaintenanceCommand(UUID id, String commandCode, String operation, String status,
            @Schema(nullable = true) String reason, @Schema(nullable = true) String slotCode,
            @Schema(nullable = true) Integer removedCount, @Schema(nullable = true) String reconciliationOutcome, Instant createdAt) { }
}
