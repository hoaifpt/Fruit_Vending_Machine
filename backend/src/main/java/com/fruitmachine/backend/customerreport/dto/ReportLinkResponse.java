package com.fruitmachine.backend.customerreport.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;

/** The public report URL of a machine (shown as a QR code by the kiosk). */
public record ReportLinkResponse(UUID machineId,
        @Schema(example = "https://staging.freshvend.vn/report/Q2x9…?order=ORD-20261114-K7QF2M9A") String url) {
}
