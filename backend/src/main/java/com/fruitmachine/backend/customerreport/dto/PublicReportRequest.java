package com.fruitmachine.backend.customerreport.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fruitmachine.backend.customerreport.enums.ReportType;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * The JSON part "report" of a public submission. Validation is done by PublicReportService in a fixed order (the honeypot first), so
 * the fields carry no bean-validation annotations; unknown fields are rejected while reading.
 */
@Schema(additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
public record PublicReportRequest(
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) ReportType type,
        @Schema(types = {"string", "null"}, description = "ORD-yyyyMMdd-XXXXXXXX (case-insensitive); required for PAID_NOT_RECEIVED.",
                example = "ORD-20261114-K7QF2M9A") String orderCode,
        @Schema(types = {"string", "null"}, maxLength = 1000, description = "Required except for PAID_NOT_RECEIVED; control characters are removed.")
        String description,
        @Schema(types = {"string", "null"}, maxLength = 100) String contactName,
        @Schema(types = {"string", "null"}, description = "^(0|\\+84)[0-9]{9,10}$; phone or email is required for PAID_NOT_RECEIVED and PRODUCT_QUALITY.",
                example = "0901234567") String contactPhone,
        @Schema(types = {"string", "null"}, maxLength = 254) String contactEmail,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Must be true: the customer accepted the privacy notice.") Boolean consent,
        @Schema(types = {"string", "null"}, description = "Honeypot: leave empty. A filled value is accepted silently and nothing is stored.")
        String website) {

    @JsonAnySetter
    public void rejectUnknownField(String field, Object value) {
        throw new IllegalArgumentException("Unknown request field");
    }
}
