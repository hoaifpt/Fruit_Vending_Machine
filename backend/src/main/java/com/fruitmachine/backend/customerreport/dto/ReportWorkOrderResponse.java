package com.fruitmachine.backend.customerreport.dto;

import com.fruitmachine.backend.workorder.enums.WorkOrderStatus;
import java.util.UUID;

public record ReportWorkOrderResponse(UUID id, String code, WorkOrderStatus status) {
}
