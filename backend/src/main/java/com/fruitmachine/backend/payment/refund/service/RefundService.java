package com.fruitmachine.backend.payment.refund.service;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fruitmachine.backend.audit.entity.AuditLog;
import com.fruitmachine.backend.audit.repository.AuditLogRepository;
import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.dispense.enums.DispenseStatus;
import com.fruitmachine.backend.dispense.repository.DispenseCommandRepository;
import com.fruitmachine.backend.order.entity.Order;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.order.repository.OrderRepository;
import com.fruitmachine.backend.order.service.OrderTransitions;
import com.fruitmachine.backend.payment.dto.PaymentDetailResponse;
import com.fruitmachine.backend.payment.entity.Payment;
import com.fruitmachine.backend.payment.enums.PaymentStatus;
import com.fruitmachine.backend.payment.enums.RefundReason;
import com.fruitmachine.backend.payment.mapper.PaymentMapper;
import com.fruitmachine.backend.payment.refund.dto.RefundPaymentRequest;
import com.fruitmachine.backend.payment.repository.PaymentRepository;
import com.fruitmachine.backend.payment.service.PaymentTransitions;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.user.repository.UserRepository;
import com.fruitmachine.backend.workorder.entity.WorkOrder;
import com.fruitmachine.backend.workorder.enums.WorkOrderStatus;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;
import com.fruitmachine.backend.workorder.repository.WorkOrderRepository;
import com.fruitmachine.backend.workorder.service.WorkOrderService;
import jakarta.persistence.EntityManager;
import jakarta.validation.Valid;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Records manual refunds (issue #72): the money was already transferred by an administrator in the banking app; the backend never
 * calls a provider. One transaction with the lock order Order -> Payments (-> DispenseCommand read -> WorkOrder), so concurrent
 * requests for the same payment serialize and exactly one succeeds. The transfer reference and payer data are never logged.
 */
@Slf4j
@Service
@Validated
@RequiredArgsConstructor
public class RefundService {
    public static final String AUDIT_ACTION = "PAYMENT_REFUNDED";
    public static final String ALREADY_REFUNDED = "PAYMENT_ALREADY_REFUNDED";
    public static final String TRANSFER_REF_USED = "REFUND_TRANSFER_REF_USED";
    public static final String DISPENSE_IN_PROGRESS = "DISPENSE_IN_PROGRESS";
    public static final String REASON_MISMATCH = "REFUND_REASON_MISMATCH";
    public static final String NOT_REFUNDABLE = "PAYMENT_NOT_REFUNDABLE";

    private static final Set<OrderStatus> UNRESOLVED = EnumSet.of(OrderStatus.PENDING_PAYMENT, OrderStatus.PAID, OrderStatus.DISPENSING);
    private static final Set<DispenseStatus> UNFINISHED_DISPENSE = EnumSet.of(DispenseStatus.PENDING, DispenseStatus.SENT, DispenseStatus.ACKNOWLEDGED);
    /** Money that really arrived, in arrival order: the first one paid the order, later ones are duplicates. */
    static final Comparator<Payment> ARRIVAL = Comparator.comparing(Payment::getPaidAt, Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(Payment::getId);

    private final PaymentRepository payments;
    private final OrderRepository orders;
    private final DispenseCommandRepository dispenseCommands;
    private final WorkOrderRepository workOrders;
    private final WorkOrderService workOrderService;
    private final UserRepository users;
    private final AuditLogRepository audits;
    private final PaymentMapper mapper;
    private final EntityManager entityManager;
    private final Clock clock;
    private final org.springframework.context.ApplicationEventPublisher events;

    @Transactional
    @PreAuthorize(Permissions.HAS_PAYMENT_REFUND)
    public PaymentDetailResponse refund(UUID paymentId, @Valid RefundPaymentRequest request) {
        if (request.reason() == RefundReason.OTHER && request.note() == null)
            throw new BadRequestException("A note is required for reason OTHER");
        UUID orderId = payments.findOrderIdById(paymentId).orElseThrow(() -> new ResourceNotFoundException("Payment not found"));
        Order order = orders.findForUpdateById(orderId).orElseThrow(() -> new ResourceNotFoundException("Payment not found"));
        List<Payment> attempts = payments.findForUpdateByOrderId(orderId);
        Payment payment = attempts.stream().filter(p -> p.getId().equals(paymentId)).findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Payment not found"));
        PaymentStatus paymentBefore = payment.getStatus();
        OrderStatus orderBefore = order.getStatus();

        if (paymentBefore == PaymentStatus.REFUNDED) throw conflict(ALREADY_REFUNDED, "this payment was already refunded");
        if (paymentBefore != PaymentStatus.SUCCESS)
            throw conflict(NOT_REFUNDABLE, "only a SUCCESS payment can be refunded (this one is " + paymentBefore + ")");
        if (UNRESOLVED.contains(orderBefore) || dispenseCommands.existsByOrderIdAndStatusIn(orderId, UNFINISHED_DISPENSE))
            throw conflict(DISPENSE_IN_PROGRESS, "the order is " + orderBefore + "; wait for the final dispense result");
        boolean paying = isPayingPayment(payment, attempts);
        requireConsistentReason(request.reason(), orderBefore, paying);
        String reference = request.transferReference();
        if (payments.existsByRefundTransferRef(reference)) throw transferReferenceUsed();
        WorkOrder workOrder = request.workOrderId() == null ? null : incidentWorkOrder(request.workOrderId());

        User actor = users.getReferenceById(actorId());
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        PaymentTransitions.refund(payment);
        payment.setRefundedAt(notBefore(now, payment.getPaidAt()));
        payment.setRefundedBy(actor);
        payment.setRefundReason(request.reason());
        payment.setRefundTransferRef(reference);
        payment.setRefundNote(request.note());
        // The order is refunded only when its paying payment is returned; late and duplicate money never changes it.
        if (paying && OrderTransitions.refundable(order)) OrderTransitions.refund(order, notBefore(now, order.getPaidAt()));
        try {
            payments.flush();
            orders.flush();
        } catch (DataIntegrityViolationException ex) {
            // Another refund recorded the same transfer between the check and the write (unique index).
            throw transferReferenceUsed();
        }

        audit(actor, payment, order, paymentBefore, orderBefore);
        // Issue #74: open customer reports of this order are closed as REFUNDED (synchronous listener, same transaction).
        events.publishEvent(new com.fruitmachine.backend.payment.refund.event.PaymentRefundedEvent(payment.getId(), orderId, actor.getId(), request.reason()));
        if (workOrder != null) {
            var details = JsonNodeFactory.instance.objectNode().put("paymentId", payment.getId().toString())
                    .put("orderCode", order.getOrderCode()).put("reason", request.reason().name());
            workOrderService.recordNote(workOrder, "Refunded " + payment.getAmount().toPlainString() + " for order " + order.getOrderCode()
                    + " (" + request.reason() + ", ref " + reference + ")", details);
        }
        log.info("Refund recorded for payment {} of order {} ({})", payment.getId(), order.getOrderCode(), request.reason());
        entityManager.flush();
        entityManager.clear();
        return mapper.detail(payments.findWithOrderById(paymentId).orElseThrow());
    }

    /** The order's paying payment: the first money that arrived (SUCCESS or already REFUNDED). */
    static boolean isPayingPayment(Payment payment, List<Payment> attempts) {
        return attempts.stream().filter(p -> p.getStatus() == PaymentStatus.SUCCESS || p.getStatus() == PaymentStatus.REFUNDED)
                .min(ARRIVAL).map(first -> first.getId().equals(payment.getId())).orElse(false);
    }

    private static void requireConsistentReason(RefundReason reason, OrderStatus order, boolean paying) {
        boolean consistent = switch (reason) {
            case DISPENSE_FAILED -> order == OrderStatus.DISPENSE_FAILED && paying;
            case LATE_PAYMENT -> order == OrderStatus.CANCELLED;
            case DUPLICATE_PAYMENT -> !paying;
            case PRODUCT_QUALITY -> order == OrderStatus.COMPLETED && paying;
            case OTHER -> (order == OrderStatus.COMPLETED || order == OrderStatus.DISPENSE_FAILED) && paying;
        };
        if (consistent) return;
        String why = switch (reason) {
            case DISPENSE_FAILED -> "DISPENSE_FAILED needs a DISPENSE_FAILED order and its paying payment";
            case LATE_PAYMENT -> "LATE_PAYMENT needs a CANCELLED order";
            case DUPLICATE_PAYMENT -> "DUPLICATE_PAYMENT needs an earlier successful payment of the same order; this one paid the order";
            case PRODUCT_QUALITY -> "PRODUCT_QUALITY needs a COMPLETED order and its paying payment";
            case OTHER -> "OTHER needs a COMPLETED or DISPENSE_FAILED order and its paying payment";
        };
        throw conflict(REASON_MISMATCH, why + " (order is " + order + ")");
    }

    private WorkOrder incidentWorkOrder(UUID id) {
        WorkOrder workOrder = workOrders.findForUpdateById(id).orElseThrow(() -> new BadRequestException("workOrderId: work order not found"));
        if (workOrder.getType() != WorkOrderType.INCIDENT || workOrder.getStatus() == WorkOrderStatus.CANCELLED)
            throw new BadRequestException("workOrderId must reference an INCIDENT work order that is not CANCELLED");
        return workOrder;
    }

    private void audit(User actor, Payment payment, Order order, PaymentStatus paymentBefore, OrderStatus orderBefore) {
        var factory = JsonNodeFactory.instance;
        ObjectNode before = factory.objectNode().put("paymentStatus", paymentBefore.name()).put("orderStatus", orderBefore.name());
        ObjectNode after = factory.objectNode().put("paymentStatus", payment.getStatus().name()).put("orderStatus", order.getStatus().name())
                .put("reason", payment.getRefundReason().name()).put("transferReference", payment.getRefundTransferRef())
                .put("amount", payment.getAmount().toPlainString()).put("orderCode", order.getOrderCode());
        var row = new AuditLog();
        row.setUser(actor);
        row.setAction(AUDIT_ACTION);
        row.setEntityType("Payment");
        row.setEntityId(payment.getId());
        row.setOldValue(before);
        row.setNewValue(after);
        row.setIpAddress(clientIp());
        audits.save(row);
    }

    private static ConflictException transferReferenceUsed() {
        return conflict(TRANSFER_REF_USED, "this bank transfer reference is already recorded for another refund");
    }

    private static ConflictException conflict(String code, String message) {
        return new ConflictException(code + ": " + message);
    }

    private static UUID actorId() {
        return ((AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal()).getId();
    }

    /** The caller's address as seen by the backend; at most 45 characters. */
    private static String clientIp() {
        if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes)) return null;
        String address = attributes.getRequest().getRemoteAddr();
        if (address == null || address.isBlank()) return null;
        return address.length() > 45 ? address.substring(0, 45) : address;
    }

    private static Instant notBefore(Instant candidate, Instant floor) {
        return floor != null && candidate.isBefore(floor) ? floor : candidate;
    }
}
