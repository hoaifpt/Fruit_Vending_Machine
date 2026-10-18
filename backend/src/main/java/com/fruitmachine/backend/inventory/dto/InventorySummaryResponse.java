package com.fruitmachine.backend.inventory.dto;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;
@Schema(description = "DB counts at asOf: occupied AVAILABLE/RESERVED/EXPIRED/DISPENSE_FAILED; available AVAILABLE+unexpired; sellable additionally ACTIVE product/machine/slot; expiredCount counts physically present expired boxes. Remaining capacity clamped at zero for legacy overcapacity.")
public record InventorySummaryResponse(UUID machineId, UUID slotId, int capacity, long occupiedCount, long availableCount,
        long expiredCount, long reservedCount, long sellableCount, long remainingCapacity, Instant asOf,
        @Schema(description = "Status of the slot head, the physically present bowl dispensed next (earliest loadedAt, tie-break id); null when the slot is empty. "
                + "Only an AVAILABLE, unexpired head can be sold; any other head blocks the whole column.", allowableValues = {"AVAILABLE", "RESERVED", "EXPIRED", "DISPENSE_FAILED"},
                nullable = true) com.fruitmachine.backend.inventory.enums.InventoryStatus headStatus,
        @Schema(description = "true when the head has status EXPIRED or its batch is expired at asOf; staff must remove it before the column can sell again. false when empty.")
        boolean headExpired) {}
