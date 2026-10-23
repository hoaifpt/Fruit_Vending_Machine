package com.fruitmachine.backend.dispense.dto;

import com.fruitmachine.backend.dispense.entity.DispenseCommand;
import com.fruitmachine.backend.dispense.enums.DispenseStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "Backend-authorized command for one reserved bowl. slotId is immutable; the station maps it to its configured physical column. Read responses never expose the dispatch token.")
public record DispenseCommandResponse(UUID id, String commandCode, UUID orderId, UUID machineId,
        UUID slotId, UUID inventoryItemId, DispenseStatus status, Instant createdAt, Instant sentAt,
        Instant acknowledgedAt, Instant completedAt) {
    public static DispenseCommandResponse from(DispenseCommand command) {
        return new DispenseCommandResponse(command.getId(), command.getCommandCode(), command.getOrderId(),
                command.getMachineId(), command.getSlotId(), command.getInventoryItemId(), command.getStatus(),
                command.getCreatedAt(), command.getSentAt(), command.getAcknowledgedAt(), command.getCompletedAt());
    }
}
