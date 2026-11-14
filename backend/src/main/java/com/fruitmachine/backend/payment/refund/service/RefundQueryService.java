package com.fruitmachine.backend.payment.refund.service;

import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.order.entity.Order;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.payment.dto.RefundActorResponse;
import com.fruitmachine.backend.payment.entity.Payment;
import com.fruitmachine.backend.payment.enums.PaymentStatus;
import com.fruitmachine.backend.payment.enums.RefundReason;
import com.fruitmachine.backend.payment.refund.dto.*;
import com.fruitmachine.backend.security.permission.Permissions;
import jakarta.persistence.EntityManager;
import jakarta.persistence.TypedQuery;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Refund to-do list, recorded refunds and totals (issue #72). Each page is one query with its to-one associations fetched
 * (plus one count query and one indexed webhook-log query for payers): no N+1. Dates are business-zone days.
 */
@Service
@RequiredArgsConstructor
public class RefundQueryService {
    /** An earlier money arrival for the same order: this payment is a duplicate. */
    private static final String EARLIER_PAYMENT = "exists (select 1 from Payment e where e.order = o and e.id <> p.id"
            + " and e.status in (:paidStatuses) and (e.paidAt < p.paidAt or (e.paidAt = p.paidAt and e.id < p.id)))";
    /** Issue #74: an open customer report of the order that may lead to a refund. */
    private static final String REPORTED = "exists (select 1 from CustomerReport r where r.orderId = o.id and r.status in (:openReports)"
            + " and r.verdict in (:reportVerdicts))";
    private static final List<PaymentStatus> PAID_STATUSES = List.of(PaymentStatus.SUCCESS, PaymentStatus.REFUNDED);
    private static final List<OrderStatus> UNRESOLVED = List.of(OrderStatus.PENDING_PAYMENT, OrderStatus.PAID, OrderStatus.DISPENSING);

    private final EntityManager entityManager;
    private final PayerAccountResolver payers;
    private final BusinessCalendar calendar;

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_REFUND_READ)
    public RefundCandidatePageResponse candidates(RefundCandidateType type, UUID machineId, LocalDate from, LocalDate to, int page, int size) {
        requireRange(from, to);
        StringBuilder where = new StringBuilder(" where p.status = :success and o.status not in (:unresolved)");
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("success", PaymentStatus.SUCCESS);
        params.put("unresolved", UNRESOLVED);
        params.put("paidStatuses", PAID_STATUSES);
        if (type == null) {
            where.append(" and (o.status = :cancelled or o.status = :failed or ").append(EARLIER_PAYMENT).append(" or ").append(REPORTED).append(")");
            params.put("cancelled", OrderStatus.CANCELLED);
            params.put("failed", OrderStatus.DISPENSE_FAILED);
        } else {
            switch (type) {
                case LATE_PAYMENT -> {
                    where.append(" and o.status = :cancelled");
                    params.put("cancelled", OrderStatus.CANCELLED);
                }
                case DUPLICATE_PAYMENT -> {
                    where.append(" and o.status <> :cancelled and ").append(EARLIER_PAYMENT);
                    params.put("cancelled", OrderStatus.CANCELLED);
                }
                case DISPENSE_FAILED -> {
                    where.append(" and o.status = :failed and not ").append(EARLIER_PAYMENT);
                    params.put("failed", OrderStatus.DISPENSE_FAILED);
                }
                case CUSTOMER_REPORT -> where.append(" and ").append(REPORTED);
            }
        }
        if (!where.toString().contains(":paidStatuses")) params.remove("paidStatuses");
        if (where.toString().contains(":openReports")) {
            params.put("openReports", com.fruitmachine.backend.customerreport.enums.ReportStatus.OPEN);
            params.put("reportVerdicts", List.of(com.fruitmachine.backend.customerreport.enums.ReportVerdict.REFUND_ELIGIBLE,
                    com.fruitmachine.backend.customerreport.enums.ReportVerdict.DELIVERED_PER_MACHINE));
        }
        filters(where, params, "p.paidAt", machineId, from, to);

        long total = count("select count(p) from Payment p join p.order o" + where, params);
        TypedQuery<Payment> query = entityManager.createQuery("select p from Payment p join fetch p.order o join fetch o.machine m" + where
                + " order by p.paidAt asc, p.id asc", Payment.class);
        params.forEach(query::setParameter);
        List<Payment> rows = query.setFirstResult(page * size).setMaxResults(size).getResultList();
        List<Boolean> duplicates = duplicates(rows);
        var payerByPayment = payers.resolve(rows);
        Map<UUID, Object[]> reportByOrder = openReports(rows.stream().map(p -> p.getOrder().getId()).distinct().toList());
        List<RefundCandidateResponse> content = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            Payment payment = rows.get(i);
            Order order = payment.getOrder();
            Object[] report = reportByOrder.get(order.getId());
            RefundCandidateType kind = type == RefundCandidateType.CUSTOMER_REPORT ? RefundCandidateType.CUSTOMER_REPORT
                    : order.getStatus() == OrderStatus.CANCELLED ? RefundCandidateType.LATE_PAYMENT
                    : duplicates.get(i) ? RefundCandidateType.DUPLICATE_PAYMENT
                    : order.getStatus() == OrderStatus.DISPENSE_FAILED ? RefundCandidateType.DISPENSE_FAILED : RefundCandidateType.CUSTOMER_REPORT;
            content.add(new RefundCandidateResponse(payment.getId(), kind, payment.getAmount(), payment.getPaidAt(), order(order),
                    payerByPayment.get(payment.getId()), payment.getPaidAt(), report == null || report[7] == null ? null
                            : new RefundWorkOrderResponse((UUID) report[7], (String) report[8]), report == null ? null : reportResponse(report)));
        }
        return new RefundCandidatePageResponse(content, page, size, total, pages(total, size));
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_REFUND_READ)
    public RefundPageResponse list(LocalDate from, LocalDate to, RefundReason reason, UUID machineId, UUID refundedBy, int page, int size) {
        requireRange(from, to);
        StringBuilder where = new StringBuilder(" where p.status = :refunded");
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("refunded", PaymentStatus.REFUNDED);
        if (reason != null) {
            where.append(" and p.refundReason = :reason");
            params.put("reason", reason);
        }
        if (refundedBy != null) {
            where.append(" and p.refundedBy.id = :refundedBy");
            params.put("refundedBy", refundedBy);
        }
        filters(where, params, "p.refundedAt", machineId, from, to);
        long total = count("select count(p) from Payment p join p.order o" + where, params);
        TypedQuery<Payment> query = entityManager.createQuery("select p from Payment p join fetch p.order o join fetch o.machine m"
                + " join fetch p.refundedBy u" + where + " order by p.refundedAt desc, p.id desc", Payment.class);
        params.forEach(query::setParameter);
        List<RefundResponse> content = query.setFirstResult(page * size).setMaxResults(size).getResultList().stream()
                .map(p -> new RefundResponse(p.getId(), p.getAmount(), p.getPaidAt(), p.getRefundedAt(),
                        new RefundActorResponse(p.getRefundedBy().getId(), p.getRefundedBy().getFullName()), p.getRefundReason(),
                        p.getRefundTransferRef(), p.getRefundNote(), order(p.getOrder())))
                .toList();
        return new RefundPageResponse(content, page, size, total, pages(total, size));
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_REFUND_READ)
    public RefundSummaryResponse summary(LocalDate from, LocalDate to, UUID machineId) {
        requireRange(from, to);
        StringBuilder where = new StringBuilder(" where p.status = :refunded");
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("refunded", PaymentStatus.REFUNDED);
        filters(where, params, "p.refundedAt", machineId, from, to);
        TypedQuery<Object[]> query = entityManager.createQuery("select p.refundReason, count(p), coalesce(sum(p.amount), 0)"
                + " from Payment p join p.order o" + where + " group by p.refundReason", Object[].class);
        params.forEach(query::setParameter);
        Map<RefundReason, RefundSummaryResponse.ReasonTotal> byReason = new EnumMap<>(RefundReason.class);
        for (RefundReason reason : RefundReason.values()) byReason.put(reason, new RefundSummaryResponse.ReasonTotal(reason, 0, money(BigDecimal.ZERO)));
        long count = 0;
        BigDecimal amount = BigDecimal.ZERO;
        for (Object[] row : query.getResultList()) {
            RefundReason reason = (RefundReason) row[0];
            long rowCount = ((Number) row[1]).longValue();
            BigDecimal rowAmount = toDecimal(row[2]);
            byReason.put(reason, new RefundSummaryResponse.ReasonTotal(reason, rowCount, money(rowAmount)));
            count += rowCount;
            amount = amount.add(rowAmount);
        }
        return new RefundSummaryResponse(from, to, machineId, count, money(amount), List.copyOf(byReason.values()));
    }

    private void filters(StringBuilder where, Map<String, Object> params, String timeField, UUID machineId, LocalDate from, LocalDate to) {
        if (machineId != null) {
            where.append(" and o.machine.id = :machineId");
            params.put("machineId", machineId);
        }
        if (from != null) {
            where.append(" and ").append(timeField).append(" >= :fromInstant");
            params.put("fromInstant", calendar.dayStart(from));
        }
        if (to != null) {
            where.append(" and ").append(timeField).append(" < :toInstant");
            params.put("toInstant", calendar.dayEnd(to));
        }
    }

    /** Which rows have an earlier money arrival for their order: one query for the whole page. */
    private List<Boolean> duplicates(List<Payment> rows) {
        if (rows.isEmpty()) return List.of();
        List<UUID> ids = rows.stream().map(Payment::getId).toList();
        List<UUID> duplicated = entityManager.createQuery("select p.id from Payment p join p.order o where p.id in (:ids) and " + EARLIER_PAYMENT,
                UUID.class).setParameter("ids", ids).setParameter("paidStatuses", PAID_STATUSES).getResultList();
        return rows.stream().map(p -> duplicated.contains(p.getId())).toList();
    }

    /** The oldest open customer report of each order (with its work order), one query per page; contact masked. */
    private Map<UUID, Object[]> openReports(List<UUID> orderIds) {
        Map<UUID, Object[]> result = new java.util.HashMap<>();
        if (orderIds.isEmpty()) return result;
        entityManager.createQuery("select r.orderId, r.id, r.code, r.verdict, r.contactName, r.contactPhone, r.contactEmail, w.id, w.code"
                + " from CustomerReport r left join r.workOrder w where r.orderId in (:orders) and r.status in (:open) order by r.createdAt, r.id", Object[].class)
                .setParameter("orders", orderIds).setParameter("open", com.fruitmachine.backend.customerreport.enums.ReportStatus.OPEN)
                .getResultList().forEach(row -> result.putIfAbsent((UUID) row[0], row));
        return result;
    }

    private static RefundCandidateReportResponse reportResponse(Object[] row) {
        String name = (String) row[4];
        return new RefundCandidateReportResponse((UUID) row[1], (String) row[2], row[3].toString(),
                name == null || name.isEmpty() ? name : name.charAt(0) + "***",
                com.fruitmachine.backend.customerreport.service.ReportSupport.maskPhone((String) row[5]),
                com.fruitmachine.backend.customerreport.service.ReportSupport.maskEmail((String) row[6]));
    }

    private long count(String jpql, Map<String, Object> params) {
        TypedQuery<Long> query = entityManager.createQuery(jpql, Long.class);
        params.forEach(query::setParameter);
        return query.getSingleResult();
    }

    private static RefundOrderResponse order(Order order) {
        return new RefundOrderResponse(order.getId(), order.getOrderCode(), order.getStatus(), order.getMachine().getCode());
    }

    private static void requireRange(LocalDate from, LocalDate to) {
        if (from != null && to != null && to.isBefore(from)) throw new BadRequestException("to must not be before from");
    }

    private static int pages(long total, int size) {
        return (int) ((total + size - 1) / size);
    }

    private static BigDecimal toDecimal(Object value) {
        return value instanceof BigDecimal decimal ? decimal : new BigDecimal(value.toString());
    }

    private static BigDecimal money(BigDecimal value) {
        return value.setScale(2, java.math.RoundingMode.UNNECESSARY);
    }
}
