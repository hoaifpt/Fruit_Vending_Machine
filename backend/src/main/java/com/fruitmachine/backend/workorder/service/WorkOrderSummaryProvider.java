package com.fruitmachine.backend.workorder.service;

import com.fruitmachine.backend.workorder.dto.WorkOrderRestockSummary;
import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/** Extension point (issue #68): the restock summary of RESTOCK work orders, one query per page of work orders. */
public interface WorkOrderSummaryProvider {
    Map<UUID, WorkOrderRestockSummary> restockSummaries(Collection<UUID> workOrderIds);
}
