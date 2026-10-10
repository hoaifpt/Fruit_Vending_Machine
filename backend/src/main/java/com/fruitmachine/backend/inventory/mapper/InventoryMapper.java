package com.fruitmachine.backend.inventory.mapper;

import com.fruitmachine.backend.inventory.dto.*;
import com.fruitmachine.backend.inventory.entity.*;
import java.time.Instant;
import org.springframework.stereotype.Component;

@Component
public class InventoryMapper {
    public InventoryItemResponse item(InventoryItem item, Instant now) {
        var batch = item.getBatch(); var product = batch.getProduct(); var slot = item.getSlot();
        return new InventoryItemResponse(item.getId(), batch.getId(), batch.getBatchCode(), product.getId(), product.getName(),
                slot == null ? null : slot.getMachine().getId(), slot == null ? null : slot.getId(), slot == null ? null : slot.getSlotCode(),
                item.getStatus(), batch.getExpiresAt(), !batch.getExpiresAt().isAfter(now), item.getLoadedAt(), item.getRemovedAt(), item.getCreatedAt(), item.getUpdatedAt());
    }
    public InventoryTransactionResponse transaction(InventoryTransaction history) {
        var item = history.getInventoryItem(); var batch = item.getBatch();
        return new InventoryTransactionResponse(history.getId(), item.getId(), batch.getId(), batch.getBatchCode(),
                history.getMachineId(), history.getSlotId(), history.getType(), history.getReferenceId(),
                history.getPerformedBy() == null ? null : history.getPerformedBy().getId(), history.getReason(), history.getStatusBefore(), history.getStatusAfter(), history.getCreatedAt());
    }
}
