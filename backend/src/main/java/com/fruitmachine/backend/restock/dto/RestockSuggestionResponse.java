package com.fruitmachine.backend.restock.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import java.util.UUID;

@Schema(description = "Restock suggestions of a machine: one entry per slot. Read-only, nothing is locked.")
public record RestockSuggestionResponse(UUID machineId, String machineCode,
        @Schema(description = "LOW_STOCK threshold used: sellable at most this many is low.") int lowStockThreshold,
        List<SlotSuggestion> slots) {

    public enum Action { NONE, LOAD, EMPTY_THEN_LOAD }

    public record CurrentProduct(UUID id, String name) { }

    public record SlotSuggestion(UUID slotId, String slotCode, int capacity, String slotStatus, boolean refillGateOpen,
            @Schema(description = "Bowls in the column (AVAILABLE, RESERVED, EXPIRED, DISPENSE_FAILED).") long physicalCount,
            @Schema(description = "Bowls a customer can buy now (0 when the head blocks the column).") long sellableCount,
            long expiredCount, long expiringTodayCount, long dispenseFailedCount,
            @Schema(nullable = true, description = "Status of the head bowl (EXPIRED when its batch expired); null for an empty column.") String headStatus,
            @Schema(nullable = true, description = "Product of the most recently loaded bowl still in the column; null when empty.") CurrentProduct currentProduct,
            Action suggestedAction,
            @Schema(description = "Capacity minus the bowls left after the suggested action.") int suggestedLoadQuantity,
            List<String> openAlerts) { }
}
