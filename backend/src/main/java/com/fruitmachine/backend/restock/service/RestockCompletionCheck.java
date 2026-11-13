package com.fruitmachine.backend.restock.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fruitmachine.backend.restock.entity.RestockLine;
import com.fruitmachine.backend.restock.repository.RestockLineRepository;
import com.fruitmachine.backend.restock.repository.RestockQueries;
import com.fruitmachine.backend.workorder.dto.CompleteWorkOrderRequest;
import com.fruitmachine.backend.workorder.dto.LineVariance;
import com.fruitmachine.backend.workorder.entity.WorkOrder;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;
import com.fruitmachine.backend.workorder.service.WorkOrderCompletionCheck;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * RESTOCK completion (issue #68 §5): every line loaded as planned or explained (lineVariances, stored on the line), every refill gate
 * of the machine closed. The COMPLETED event carries a per-line summary and the bowls removed by linked maintenance commands.
 */
@Component
@RequiredArgsConstructor
public class RestockCompletionCheck implements WorkOrderCompletionCheck {
    public static final String VARIANCE_REASON_REQUIRED = "RESTOCK_VARIANCE_REASON_REQUIRED";
    public static final String REFILL_GATE_OPEN = "REFILL_GATE_OPEN";

    private final RestockLineRepository lines;
    private final RestockQueries queries;
    private final RestockViewService views;
    private final ObjectMapper json;

    @Override
    public boolean supports(WorkOrderType type) {
        return type == WorkOrderType.RESTOCK;
    }

    @Override
    public void check(WorkOrder order, CompleteWorkOrderRequest request) {
        Map<UUID, String> given = new HashMap<>();
        if (request.lineVariances() != null) for (LineVariance variance : request.lineVariances()) given.put(variance.lineId(), variance.reason());
        List<String> missing = new ArrayList<>();
        for (RestockLine line : lines.findDetailsByWorkOrderId(order.getId())) {
            String reason = given.get(line.getId());
            if (reason != null) line.setVarianceReason(reason);
            if (line.getLoadedQuantity() != line.getPlannedQuantity() && line.getVarianceReason() == null)
                missing.add(line.getId() + " (" + line.getSlot().getSlotCode() + ": planned " + line.getPlannedQuantity() + ", loaded " + line.getLoadedQuantity() + ")");
        }
        if (!missing.isEmpty())
            throw RestockPlanningService.conflict(VARIANCE_REASON_REQUIRED, "give lineVariances for " + String.join(", ", missing));
        List<String> open = queries.openRefillGates(order.getMachineId());
        if (!open.isEmpty()) throw RestockPlanningService.conflict(REFILL_GATE_OPEN, "close the refill gate of slot(s) " + String.join(", ", open) + " (CLOSE_REFILL)");
        lines.flush();
    }

    @Override
    public void summarize(WorkOrder order, ObjectNode details) {
        ObjectNode restock = details.putObject("restock");
        ArrayNode summary = restock.putArray("lines");
        for (RestockLine line : lines.findDetailsByWorkOrderId(order.getId())) {
            summary.addObject().put("lineId", line.getId().toString()).put("slotCode", line.getSlot().getSlotCode())
                    .put("productId", line.getProductId().toString()).put("productName", line.getProduct().getName())
                    .put("planned", line.getPlannedQuantity()).put("loaded", line.getLoadedQuantity())
                    .put("variance", line.getLoadedQuantity() - line.getPlannedQuantity()).put("reason", line.getVarianceReason());
        }
        restock.set("removedByReason", json.valueToTree(views.removedByReason(order.getId())));
    }
}
