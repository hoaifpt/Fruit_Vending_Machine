package com.fruitmachine.backend.inventory.dto;

import com.fruitmachine.backend.inventory.enums.InventoryStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

@Schema(description = "One physical box; nullable location for legacy off-machine rows. Expired is derived from batch expiry at request time, independent of stored status.")
public record InventoryItemResponse(UUID id, UUID batchId, String batchCode, UUID productId, String productName,
        UUID machineId, UUID slotId, String slotCode, InventoryStatus status, Instant expiresAt,
        boolean expired, Instant loadedAt, Instant removedAt, Instant createdAt, Instant updatedAt) {}
