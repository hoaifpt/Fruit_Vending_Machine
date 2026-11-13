package com.fruitmachine.backend.workorder.service;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fruitmachine.backend.workorder.dto.CompleteWorkOrderRequest;
import com.fruitmachine.backend.workorder.entity.WorkOrder;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;

/**
 * Extension point (issue #66, used by restock #68): type-specific checks before a work order may be completed. Throw a
 * ConflictException (or BadRequestException) to refuse. Called under the work order row lock, inside the completing transaction.
 */
public interface WorkOrderCompletionCheck {
    boolean supports(WorkOrderType type);

    void check(WorkOrder workOrder, CompleteWorkOrderRequest request);

    /** Adds a summary to the COMPLETED history event, after {@link #check} passed. */
    default void summarize(WorkOrder workOrder, ObjectNode details) {
    }
}
