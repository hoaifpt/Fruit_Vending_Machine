package com.fruitmachine.backend.payment.refund.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

@Schema(description = "Issue #74: the open customer report of the order (oldest), contact masked; the full contact is in the report detail.")
public record RefundCandidateReportResponse(UUID id, String reportCode, String verdict, String contactName, String contactPhone, String contactEmail) {
}
