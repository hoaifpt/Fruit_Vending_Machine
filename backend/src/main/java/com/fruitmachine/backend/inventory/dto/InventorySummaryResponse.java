package com.fruitmachine.backend.inventory.dto;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;
@Schema(description = "DB counts at asOf: occupied AVAILABLE/RESERVED/EXPIRED/DISPENSE_FAILED; available AVAILABLE+unexpired; sellable additionally ACTIVE product/machine/slot; expiredCount counts physically present expired boxes. Remaining capacity clamped at zero for legacy overcapacity.")
public record InventorySummaryResponse(UUID machineId, UUID slotId, int capacity, long occupiedCount, long availableCount,
        long expiredCount, long reservedCount, long sellableCount, long remainingCapacity, Instant asOf) {}
