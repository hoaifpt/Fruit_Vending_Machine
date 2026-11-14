package com.fruitmachine.backend.customerreport.service;

import com.fruitmachine.backend.customerreport.repository.CustomerReportRepository;
import com.fruitmachine.backend.payment.refund.event.PaymentRefundedEvent;
import com.fruitmachine.backend.user.repository.UserRepository;
import com.fruitmachine.backend.workorder.dto.WorkOrderResponse;
import com.fruitmachine.backend.workorder.service.WorkOrderSummaryProvider;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Customer reports seen from other features (issue #74): the reports of each work order (code, type, verdict, status; no contact
 * data), and closing the open reports of an order when a refund is recorded for it (same transaction as the refund).
 */
@Component
@RequiredArgsConstructor
public class CustomerReportLinks implements WorkOrderSummaryProvider {
    private final CustomerReportRepository reports;
    private final CustomerReportAdminService admin;
    private final UserRepository users;

    @Override
    public Map<UUID, List<WorkOrderResponse.WorkOrderLinkedReport>> customerReports(Collection<UUID> workOrderIds) {
        if (workOrderIds.isEmpty()) return Map.of();
        return reports.findLinked(workOrderIds).stream().collect(Collectors.groupingBy(CustomerReportRepository.LinkedReport::getWorkOrderId,
                LinkedHashMap::new, Collectors.mapping(r -> new WorkOrderResponse.WorkOrderLinkedReport(r.getId(), r.getCode(), r.getType(),
                        r.getVerdict(), r.getStatus()), Collectors.toList())));
    }

    @EventListener
    public void onRefund(PaymentRefundedEvent event) {
        admin.closeForRefund(event.orderId(), users.getReferenceById(event.actorId()),
                "Refund recorded for payment " + event.paymentId() + " (" + event.reason() + ")");
    }
}
