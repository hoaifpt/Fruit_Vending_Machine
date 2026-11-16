package com.fruitmachine.backend.workorder.dto;

import java.util.List;

public record WorkOrderPageResponse(List<WorkOrderResponse> content, int page, int size, long totalElements, int totalPages) {
}
