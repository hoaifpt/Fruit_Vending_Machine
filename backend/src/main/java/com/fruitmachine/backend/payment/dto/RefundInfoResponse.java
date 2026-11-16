package com.fruitmachine.backend.payment.dto;

import com.fruitmachine.backend.payment.enums.RefundReason;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

@Schema(description = "Manual refund recorded for a REFUNDED payment (issue #72); null for any other payment.")
public record RefundInfoResponse(Instant refundedAt, RefundActorResponse refundedBy, RefundReason reason,
        @Schema(description = "Bank transfer reference of the refund.") String transferReference, String note) {
}
