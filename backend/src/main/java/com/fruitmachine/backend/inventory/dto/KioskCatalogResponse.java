package com.fruitmachine.backend.inventory.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import java.util.UUID;

@Schema(description = "Products of the kiosk's own machine that can be dispensed now: at least one slot has a sellable head bowl of the product. One order buys exactly one bowl. No slot, inventory item or batch identifiers are exposed.")
public record KioskCatalogResponse(UUID machineId, String machineCode,
        @Schema(description = "false when the machine is not ACTIVE; products is then empty.") boolean acceptingOrders,
        List<KioskCatalogProductResponse> products) {
}
