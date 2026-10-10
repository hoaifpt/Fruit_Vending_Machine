package com.fruitmachine.backend.inventory.dto;
import java.util.List;
public record InventoryTransactionPageResponse(List<InventoryTransactionResponse> content, int page, int size, long totalElements, int totalPages) {}
