package com.fruitmachine.backend.maintenance.dto;

import java.util.List;

public record MaintenanceCommandPageResponse(List<MaintenanceCommandResponse> content, int page, int size, long totalElements, int totalPages) {
}
