package com.fruitmachine.backend.restock.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Schema(description = "One restock line with what was loaded against it.")
public record RestockLineResponse(UUID id, UUID workOrderId, UUID slotId, String slotCode, UUID productId, String productName,
        int plannedQuantity, int loadedQuantity,
        @Schema(nullable = true) String varianceReason,
        List<RestockLoad> loads) {

    public record RestockLoad(UUID batchId, String batchCode, long quantity, Instant loadedAt,
            @Schema(nullable = true) UUID actorId, @Schema(nullable = true) String actorName) { }
}
