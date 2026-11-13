package com.fruitmachine.backend.maintenanceplan.dto;

import java.util.List;

public record MaintenancePlanPageResponse(List<MaintenancePlanResponse> content, int page, int size, long totalElements, int totalPages) {
}
