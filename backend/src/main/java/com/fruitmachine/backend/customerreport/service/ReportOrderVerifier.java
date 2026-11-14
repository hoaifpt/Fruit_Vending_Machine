package com.fruitmachine.backend.customerreport.service;

import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.customerreport.config.PublicReportProperties;
import com.fruitmachine.backend.customerreport.enums.ReportType;
import com.fruitmachine.backend.customerreport.enums.ReportVerdict;
import com.fruitmachine.backend.dispense.enums.DispenseStatus;
import com.fruitmachine.backend.dispense.repository.DispenseCommandRepository;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.payment.enums.PaymentStatus;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Instant;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Checks the order named in a report (issue #74 §4.1). The order must belong to the report's machine and be created within the
 * lookback (default 7 days, counted from the start of that business day); otherwise ORDER_NOT_FOUND. The result is stored for
 * administrators only; the public response never reveals it.
 */
@Component
@RequiredArgsConstructor
public class ReportOrderVerifier {
    private static final EnumSet<DispenseStatus> UNFINISHED_DISPENSE = EnumSet.of(DispenseStatus.PENDING, DispenseStatus.SENT, DispenseStatus.ACKNOWLEDGED);

    public record Result(ReportVerdict verdict, UUID orderId, UUID batchId) {
        static Result of(ReportVerdict verdict) {
            return new Result(verdict, null, null);
        }
    }

    private final EntityManager entityManager;
    private final DispenseCommandRepository dispenseCommands;
    private final BusinessCalendar calendar;
    private final PublicReportProperties properties;
    private final Clock clock;

    public Result verify(UUID machineId, ReportType type, String orderCode) {
        boolean checked = type == ReportType.PAID_NOT_RECEIVED || (type == ReportType.PRODUCT_QUALITY && orderCode != null);
        if (!checked) return Result.of(ReportVerdict.NOT_APPLICABLE);
        Instant since = calendar.dayStart(calendar.dayOf(clock.instant().minus(properties.orderLookback())));
        List<Object[]> rows = entityManager.createQuery("select o.id, o.status from Order o where o.orderCode = :code and o.machine.id = :machine"
                + " and o.createdAt >= :since", Object[].class)
                .setParameter("code", orderCode).setParameter("machine", machineId).setParameter("since", since).getResultList();
        if (rows.isEmpty()) return Result.of(ReportVerdict.ORDER_NOT_FOUND);
        UUID orderId = (UUID) rows.getFirst()[0];
        OrderStatus status = (OrderStatus) rows.getFirst()[1];
        ReportVerdict verdict = verdict(orderId, status);
        UUID batch = type == ReportType.PRODUCT_QUALITY && status == OrderStatus.COMPLETED ? soldBatch(orderId) : null;
        return new Result(verdict, orderId, batch);
    }

    private ReportVerdict verdict(UUID orderId, OrderStatus status) {
        List<Object[]> paid = entityManager.createQuery("select p.id, p.status, p.paidAt from Payment p where p.order.id = :order"
                + " and p.status in (:paid)", Object[].class)
                .setParameter("order", orderId).setParameter("paid", List.of(PaymentStatus.SUCCESS, PaymentStatus.REFUNDED)).getResultList();
        // The paying payment is the first money that arrived (as in the refund rules of issue #72).
        PaymentStatus paying = paid.stream()
                .min(Comparator.comparing((Object[] row) -> (Instant) row[2], Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(row -> (UUID) row[0]))
                .map(row -> (PaymentStatus) row[1]).orElse(null);
        if (status == OrderStatus.REFUNDED || paying == PaymentStatus.REFUNDED) return ReportVerdict.ALREADY_REFUNDED;
        if (status == OrderStatus.PAID || status == OrderStatus.DISPENSING || dispenseCommands.existsByOrderIdAndStatusIn(orderId, UNFINISHED_DISPENSE))
            return ReportVerdict.DISPENSE_PENDING;
        return switch (status) {
            case DISPENSE_FAILED -> paying == PaymentStatus.SUCCESS ? ReportVerdict.REFUND_ELIGIBLE : ReportVerdict.NOT_PAID;
            case COMPLETED -> ReportVerdict.DELIVERED_PER_MACHINE;
            case CANCELLED -> paying == PaymentStatus.SUCCESS ? ReportVerdict.REFUND_ELIGIBLE : ReportVerdict.NOT_PAID;
            default -> ReportVerdict.NOT_PAID;
        };
    }

    /** The batch of the bowl sold for the order (its dispensed allocation). */
    private UUID soldBatch(UUID orderId) {
        List<?> rows = entityManager.createNativeQuery("SELECT i.batch_id FROM order_item_allocations a JOIN order_items oi ON oi.id = a.order_item_id"
                + " JOIN inventory_items i ON i.id = a.inventory_item_id WHERE oi.order_id = ? ORDER BY (a.status = 'DISPENSED') DESC, a.id LIMIT 1")
                .setParameter(1, orderId).getResultList();
        return rows.isEmpty() ? null : (UUID) rows.getFirst();
    }
}
