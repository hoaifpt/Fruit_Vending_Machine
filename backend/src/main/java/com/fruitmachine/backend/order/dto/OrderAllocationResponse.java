package com.fruitmachine.backend.order.dto;

import com.fruitmachine.backend.order.enums.AllocationStatus;
import java.time.Instant;
import java.util.UUID;

public record OrderAllocationResponse(UUID id, UUID inventoryItemId, String slotCode, String batchCode,
        Instant batchExpiresAt, AllocationStatus status, Instant releasedAt) {
}
