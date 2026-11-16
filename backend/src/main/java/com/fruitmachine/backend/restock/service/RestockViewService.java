package com.fruitmachine.backend.restock.service;

import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.restock.dto.RestockLineResponse;
import com.fruitmachine.backend.restock.dto.RestockViewResponse;
import com.fruitmachine.backend.restock.entity.RestockLine;
import com.fruitmachine.backend.restock.repository.RestockLineRepository;
import com.fruitmachine.backend.restock.repository.RestockQueries;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.workorder.dto.WorkOrderRestockSummary;
import com.fruitmachine.backend.workorder.dto.WorkOrderResponse;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;
import com.fruitmachine.backend.workorder.service.WorkOrderService;
import com.fruitmachine.backend.workorder.service.WorkOrderSummaryProvider;
import java.util.*;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read side of a restock (issue #68 §6) and the restockSummary of work order responses. */
@Service
@RequiredArgsConstructor
public class RestockViewService implements WorkOrderSummaryProvider {
    private final RestockLineRepository lines;
    private final RestockQueries queries;
    private final WorkOrderService workOrders;

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_WORK_ORDER_READ_ASSIGNED)
    public RestockViewResponse view(UUID workOrderId) {
        // Visibility of the work order: 404 when the caller may not see it.
        WorkOrderResponse order = workOrders.get(workOrderId);
        if (order.type() != WorkOrderType.RESTOCK) throw new ResourceNotFoundException("Not a RESTOCK work order");
        List<RestockLineResponse> planned = lines(workOrderId);
        var commands = queries.linkedCommands(workOrderId).stream().map(c -> new RestockViewResponse.LinkedMaintenanceCommand(c.getId(), c.getCommandCode(),
                c.getOperation(), c.getStatus(), c.getReason(), c.getSlotCode(), c.getRemovedCount(), c.getReconciliationOutcome(), c.getCreatedAt())).toList();
        return new RestockViewResponse(workOrderId, order.code(), order.status().name(), planned,
                planned.stream().mapToInt(RestockLineResponse::plannedQuantity).sum(), planned.stream().mapToInt(RestockLineResponse::loadedQuantity).sum(),
                commands, removedByReason(workOrderId));
    }

    /** Bowls removed by completed (or reconciled DONE) maintenance commands linked to the work order, by reason. */
    public Map<String, Integer> removedByReason(UUID workOrderId) {
        Map<String, Integer> removed = new TreeMap<>();
        for (var c : queries.linkedCommands(workOrderId)) {
            boolean applied = "COMPLETED".equals(c.getStatus()) || ("RECONCILED".equals(c.getStatus()) && "DONE".equals(c.getReconciliationOutcome()));
            if (applied && c.getRemovedCount() != null && c.getRemovedCount() > 0 && c.getReason() != null) removed.merge(c.getReason(), c.getRemovedCount(), Integer::sum);
        }
        return removed;
    }

    @Transactional(readOnly = true)
    public RestockLineResponse line(UUID lineId) {
        RestockLine line = lines.findById(lineId).orElseThrow();
        return lines(line.getWorkOrderId()).stream().filter(l -> l.id().equals(lineId)).findFirst().orElseThrow();
    }

    List<RestockLineResponse> lines(UUID workOrderId) {
        List<RestockLine> planned = lines.findDetailsByWorkOrderId(workOrderId);
        if (planned.isEmpty()) return List.of();
        Map<UUID, List<RestockLineResponse.RestockLoad>> loads = lines.loads(planned.stream().map(RestockLine::getId).toList()).stream()
                .collect(Collectors.groupingBy(RestockLineRepository.Load::getLineId, LinkedHashMap::new, Collectors.mapping(l -> new RestockLineResponse.RestockLoad(
                        l.getBatchId(), l.getBatchCode(), l.getQuantity(), l.getLoadedAt(), l.getActorId(), l.getActorName()), Collectors.toList())));
        return planned.stream().map(l -> new RestockLineResponse(l.getId(), l.getWorkOrderId(), l.getSlotId(), l.getSlot().getSlotCode(), l.getProductId(),
                l.getProduct().getName(), l.getPlannedQuantity(), l.getLoadedQuantity(), l.getVarianceReason(), loads.getOrDefault(l.getId(), List.of()))).toList();
    }

    @Override
    public Map<UUID, WorkOrderRestockSummary> restockSummaries(Collection<UUID> workOrderIds) {
        if (workOrderIds.isEmpty()) return Map.of();
        return lines.totals(workOrderIds).stream().collect(Collectors.toMap(RestockLineRepository.Totals::getWorkOrderId,
                t -> new WorkOrderRestockSummary(t.getLines().intValue(), t.getPlanned().intValue(), t.getLoaded().intValue(), t.getVariance().intValue())));
    }
}
