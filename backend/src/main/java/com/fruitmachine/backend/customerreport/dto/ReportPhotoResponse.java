package com.fruitmachine.backend.customerreport.dto;

import java.util.UUID;

public record ReportPhotoResponse(UUID id, String contentType, int sizeBytes) {
}
