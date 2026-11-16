package com.fruitmachine.backend.customerreport.dto;

import com.fruitmachine.backend.customerreport.enums.ReportResolution;
import com.fruitmachine.backend.customerreport.enums.ReportStatus;
import com.fruitmachine.backend.customerreport.enums.ReportType;
import com.fruitmachine.backend.customerreport.enums.ReportVerdict;
import java.time.Instant;
import java.util.UUID;

public record CustomerReportSummaryResponse(UUID id, String code, ReportType type, ReportStatus status, ReportVerdict verdict, UUID machineId,
        String machineCode, String orderCode, UUID orderId, ReportContactResponse contact, ReportWorkOrderResponse workOrder,
        ReportResolution resolution, Instant createdAt, Instant resolvedAt) {
}
