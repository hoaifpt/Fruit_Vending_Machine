package com.fruitmachine.backend.customerreport.dto;

import com.fruitmachine.backend.customerreport.enums.ReportResolution;
import com.fruitmachine.backend.customerreport.enums.ReportStatus;
import com.fruitmachine.backend.customerreport.enums.ReportType;
import com.fruitmachine.backend.customerreport.enums.ReportVerdict;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record CustomerReportDetailResponse(UUID id, String code, ReportType type, ReportStatus status, ReportVerdict verdict,
        UUID machineId, String machineCode, String machineName, String description,
        @Schema(description = "The order code as typed (normalised).") String orderCodeInput,
        @Schema(description = "The verified order; null when not found or not checked.") ReportOrderResponse order,
        @Schema(description = "PRODUCT_QUALITY with a COMPLETED order: the batch of the sold bowl.") ReportBatchResponse batch,
        ReportContactResponse contact, List<ReportPhotoResponse> photos, ReportWorkOrderResponse workOrder,
        ReportResolution resolution, String resolutionNote, ReportActorResponse resolvedBy, Instant resolvedAt,
        Instant createdAt, Instant updatedAt) {
}
