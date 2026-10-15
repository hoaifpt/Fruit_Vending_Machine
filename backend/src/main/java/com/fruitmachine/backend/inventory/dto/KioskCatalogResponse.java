package com.fruitmachine.backend.inventory.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import java.util.UUID;

@Schema(description = "Sellable products of the kiosk's own machine. No slot, inventory item or batch identifiers are exposed.")
public record KioskCatalogResponse(UUID machineId, String machineCode,
        @Schema(description = "false when the machine is not ACTIVE; products is then empty.") boolean acceptingOrders,
        int maxTotalQuantity, List<KioskCatalogProductResponse> products) {
}
