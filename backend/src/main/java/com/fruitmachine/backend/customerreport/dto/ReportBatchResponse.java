package com.fruitmachine.backend.customerreport.dto;

import java.time.Instant;
import java.util.UUID;

public record ReportBatchResponse(UUID id, String batchCode, String productName, Instant expiresAt) {
}
