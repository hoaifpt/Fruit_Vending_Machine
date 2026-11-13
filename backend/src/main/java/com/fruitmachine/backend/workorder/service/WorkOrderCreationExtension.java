package com.fruitmachine.backend.workorder.service;

import com.fruitmachine.backend.workorder.dto.CreateWorkOrderRequest;
import com.fruitmachine.backend.workorder.entity.WorkOrder;

/** Extension point (issue #68): type-specific data sent with the create request, saved in the same transaction (restock lines). */
public interface WorkOrderCreationExtension {
    void afterCreate(WorkOrder workOrder, CreateWorkOrderRequest request);
}
