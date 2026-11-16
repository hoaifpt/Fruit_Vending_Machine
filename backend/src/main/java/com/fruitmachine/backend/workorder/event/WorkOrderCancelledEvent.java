package com.fruitmachine.backend.workorder.event;

import com.fruitmachine.backend.workorder.enums.WorkOrderType;
import java.util.UUID;

/** Issue #70: published when a work order becomes CANCELLED; listeners run after the commit (maintenance plans skip the occurrence). */
public record WorkOrderCancelledEvent(UUID workOrderId, UUID machineId, WorkOrderType type) {
}
