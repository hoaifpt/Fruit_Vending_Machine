package com.fruitmachine.backend.workorder.event;

import com.fruitmachine.backend.workorder.enums.WorkOrderType;
import java.util.UUID;

/** Published when a work order becomes DONE; listeners run after the commit (restock: immediate health check). */
public record WorkOrderCompletedEvent(UUID workOrderId, UUID machineId, WorkOrderType type) {
}
