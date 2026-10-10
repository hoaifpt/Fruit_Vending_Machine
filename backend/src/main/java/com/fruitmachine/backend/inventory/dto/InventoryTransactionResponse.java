package com.fruitmachine.backend.inventory.dto;
import com.fruitmachine.backend.inventory.enums.*;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;
@Schema(description = "Append-only per-item history. Location snapshots, actor UUID, grouping reference, reason/status snapshots; legacy fields may be null. Each row represents one box; no aggregate quantity column.")
public record InventoryTransactionResponse(UUID id, UUID inventoryItemId, UUID batchId, String batchCode,
        UUID machineId, UUID slotId, InventoryTransactionType type, UUID referenceId, UUID performedBy,
        String reason, InventoryStatus statusBefore, InventoryStatus statusAfter, Instant createdAt) {}
