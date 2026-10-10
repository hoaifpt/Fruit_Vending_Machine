package com.fruitmachine.backend.inventory.dto;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.*;
@Schema(description = "One server-generated operationId shared as reference_id by the N per-item LOAD history rows; not an idempotency key.")
public record InventoryLoadResponse(UUID operationId, int quantity, List<InventoryItemResponse> items) {}
