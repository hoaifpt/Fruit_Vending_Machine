package com.fruitmachine.backend.workorder.service;

import com.fruitmachine.backend.workorder.dto.WorkOrderRestockSummary;
import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/** Extension point (issue #68): the restock summary of RESTOCK work orders, one query per page of work orders. */
public interface WorkOrderSummaryProvider {
    default Map<UUID, WorkOrderRestockSummary> restockSummaries(Collection<UUID> workOrderIds) {
        return Map.of();
    }

    /** Issue #74: customer reports linked to the work orders, one query per page. */
    default Map<UUID, java.util.List<com.fruitmachine.backend.workorder.dto.WorkOrderResponse.WorkOrderLinkedReport>> customerReports(
            Collection<UUID> workOrderIds) {
        return Map.of();
    }
}
