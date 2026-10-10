package com.fruitmachine.backend.inventory.dto;
import java.util.List;
public record InventoryPageResponse(List<InventoryItemResponse> content, int page, int size, long totalElements, int totalPages) {}
