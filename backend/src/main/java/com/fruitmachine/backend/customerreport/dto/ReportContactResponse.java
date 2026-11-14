package com.fruitmachine.backend.customerreport.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Customer contact. Masked (090****567, a***@example.com) in lists and for callers without CUSTOMER_REPORT_MANAGE.")
public record ReportContactResponse(String name, String phone, String email, boolean masked) {
}
