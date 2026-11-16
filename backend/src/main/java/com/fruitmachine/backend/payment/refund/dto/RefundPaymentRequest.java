package com.fruitmachine.backend.payment.refund.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fruitmachine.backend.payment.enums.RefundReason;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;

/** A manual refund already transferred in the banking app. The amount is always the payment amount and is never sent. */
@Schema(additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record RefundPaymentRequest(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) RefundReason reason,
        @NotBlank @Pattern(regexp = TRANSFER_REF) @Schema(requiredMode = Schema.RequiredMode.REQUIRED, pattern = TRANSFER_REF, minLength = 4, maxLength = 64,
                description = "Bank transfer reference, surrounding spaces stripped; one transfer can be recorded once.", example = "FT26317123456789")
        String transferReference,
        @Size(max = 500) @Schema(maxLength = 500, description = "Required (not blank) for reason OTHER; \"\" is stored as null.") String note,
        @Schema(description = "Optional INCIDENT work order (not CANCELLED) that receives a NOTE event about the refund.") UUID workOrderId) {
    public static final String TRANSFER_REF = "^[A-Za-z0-9._/-]{4,64}$";

    public RefundPaymentRequest {
        transferReference = transferReference == null ? null : transferReference.strip();
        note = note == null || note.isBlank() ? null : note.strip();
    }

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
