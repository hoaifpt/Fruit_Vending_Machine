package com.fruitmachine.backend.payment.refund.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record RefundCandidateResponse(UUID paymentId, RefundCandidateType type, BigDecimal amount, Instant paidAt, RefundOrderResponse order,
        @Schema(description = "null when the verified webhook carried no payer account.") PayerAccountResponse payer,
        @Schema(description = "When the money arrived (paidAt); the list is oldest first.") Instant waitingSince,
        @Schema(description = "The INCIDENT work order of the customer report, when there is one (issue #74).") RefundWorkOrderResponse relatedWorkOrder,
        @Schema(description = "Open customer report of the order (issue #74); null when none.") RefundCandidateReportResponse customerReport) {
}
