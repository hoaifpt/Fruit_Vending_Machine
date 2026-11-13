package com.fruitmachine.backend.restock.dto;

import java.util.List;
import java.util.UUID;

public record RestockLoadResponse(RestockLineResponse line, int loaded, List<UUID> inventoryItemIds) {
}
