package com.fruitmachine.backend.maintenance.dto;

import com.fruitmachine.backend.maintenance.enums.MaintenanceCommandStatus;
import com.fruitmachine.backend.maintenance.enums.MaintenanceOperation;
import com.fruitmachine.backend.maintenance.enums.MaintenanceReason;
import com.fruitmachine.backend.maintenance.enums.ReconciliationOutcome;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "A maintenance command and where it stands. Inventory changed only if status is COMPLETED, or RECONCILED with outcome DONE.")
public record MaintenanceCommandResponse(
        UUID id,
        @Schema(description = "MQTT commandId, MC- and 32 hex characters.", example = "MC-3f2a9c1b7d4e4f0a8b6c5d4e3f2a1b0c") String commandCode,
        UUID machineId, String machineCode,
        @Schema(nullable = true) UUID slotId,
        @Schema(nullable = true, description = "A or B; null for RESET.") String slotCode,
        MaintenanceOperation operation, MaintenanceCommandStatus status,
        @Schema(nullable = true) MaintenanceReason reason,
        @Schema(nullable = true) String note,
        @Schema(nullable = true, description = "REMOVE_ITEM: the head bowl when the command was created.") MaintenanceTargetItem targetItem,
        MaintenanceActor requestedBy,
        @Schema(description = "Deliveries to the broker (re-sends use the same commandCode).") int attemptCount,
        Instant createdAt,
        @Schema(nullable = true) Instant sentAt,
        @Schema(nullable = true) Instant acceptedAt,
        @Schema(nullable = true) Instant finishedAt,
        @Schema(nullable = true, description = "ACCEPT_TIMEOUT, COMPLETE_TIMEOUT, HEAD_CHANGED, ACCEPTED_AFTER_TIMEOUT, CONTROLLER_FAULT, ABORTED[_<reason>] or a contract reason.")
        String failureReason,
        @Schema(nullable = true, description = "Bowls taken out of inventory by this command.") Integer removedCount,
        @Schema(nullable = true) ReconciliationOutcome reconciliationOutcome,
        @Schema(nullable = true) MaintenanceActor reconciledBy,
        @Schema(nullable = true) Instant reconciledAt) {

    public record MaintenanceTargetItem(UUID inventoryItemId, UUID productId, String productName, UUID batchId, String batchCode) { }

    public record MaintenanceActor(UUID id, String fullName) { }
}
