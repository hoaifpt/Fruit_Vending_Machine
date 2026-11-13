package com.fruitmachine.backend.payment.refund.dto;

import com.fruitmachine.backend.payment.enums.RefundReason;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Schema(description = "Refund totals by refundedAt in the business zone; every reason is listed, with 0 when there is none.")
public record RefundSummaryResponse(LocalDate from, LocalDate to, UUID machineId, long count, BigDecimal totalAmount, List<ReasonTotal> byReason) {
    public record ReasonTotal(RefundReason reason, long count, BigDecimal totalAmount) {
    }
}
