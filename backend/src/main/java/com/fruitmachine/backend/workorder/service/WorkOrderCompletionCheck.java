package com.fruitmachine.backend.workorder.service;

import com.fruitmachine.backend.workorder.entity.WorkOrder;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;

/**
 * Extension point (issue #66): type-specific checks before a work order may be completed, e.g. restock lines in 4.4. Throw a
 * ConflictException (or BadRequestException) to refuse. Called under the work order row lock.
 */
public interface WorkOrderCompletionCheck {
    boolean supports(WorkOrderType type);

    void check(WorkOrder workOrder);
}
