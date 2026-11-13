package com.fruitmachine.backend.workorder.service;

import com.fruitmachine.backend.workorder.entity.WorkOrder;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;

/** Extension point (issue #68): type-specific checks before a work order may be started, e.g. a RESTOCK needs lines. */
public interface WorkOrderStartCheck {
    boolean supports(WorkOrderType type);

    void check(WorkOrder workOrder);
}
