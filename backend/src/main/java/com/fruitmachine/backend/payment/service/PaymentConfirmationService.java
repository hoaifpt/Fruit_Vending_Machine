package com.fruitmachine.backend.payment.service;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fruitmachine.backend.order.entity.Order;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.order.repository.OrderRepository;
import com.fruitmachine.backend.payment.entity.Payment;
import com.fruitmachine.backend.payment.enums.PaymentStatus;
import com.fruitmachine.backend.payment.gateway.VerifiedPaymentEvent;
import com.fruitmachine.backend.payment.repository.PaymentRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The ONLY place that turns a payment SUCCESS and an order PAID. It runs for events whose signature was verified by the gateway,
 * in one transaction with the lock order Order, Payment (then InventoryItem elsewhere), and is idempotent: SUCCESS is terminal
 * for webhook processing. Late, duplicate, mismatched and conflicting payments are recorded for a human and never auto-resolved.
 * The provider is never called here; links of attempts expired by a PAID order are cancelled after commit.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PaymentConfirmationService {
    static final String REASON_ORDER_PAID = "ORDER_PAID";

    public enum Outcome { UNKNOWN_REFERENCE, SUCCESS_APPLIED, FAILED_APPLIED, DUPLICATE, ANOMALY, IGNORED }

    private final PaymentRepository payments;
    private final OrderRepository orders;
    private final PaymentAnomalyRecorder anomalies;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    @Transactional
    public Outcome process(String provider, VerifiedPaymentEvent event) {
        // Ids first: loading the payment before the locks would keep a stale copy in the persistence context.
        var identity = payments.findIdentity(provider, event.paymentReference()).orElse(null);
        if (identity == null) {
            // A retry cannot fix an unknown reference (payOS also uses one for its confirm-webhook probe); only the log keeps it.
            log.warn("Webhook for unknown payment reference {} ignored", event.paymentReference());
            return Outcome.UNKNOWN_REFERENCE;
        }
        Order order = orders.findForUpdateById(identity.getOrderId()).orElseThrow();
        Payment payment = payments.findForUpdateByIdAndOrderId(identity.getPaymentId(), identity.getOrderId()).orElseThrow();
        PaymentStatus paymentBefore = payment.getStatus();
        OrderStatus orderBefore = order.getStatus();

        boolean success = event.type() == VerifiedPaymentEvent.Type.SUCCESS;
        if (success ? event.amount() == null || event.amount().compareTo(payment.getAmount()) != 0
                : event.amount() != null && event.amount().compareTo(payment.getAmount()) != 0) {
            anomaly(PaymentAnomalyRecorder.AMOUNT_MISMATCH, payment, order, paymentBefore, orderBefore, event);
            return Outcome.ANOMALY;
        }
        return success ? applySuccess(provider, event, payment, order, paymentBefore, orderBefore) : applyFailed(payment);
    }

    private Outcome applyFailed(Payment payment) {
        if (payment.getStatus() != PaymentStatus.PENDING) return Outcome.IGNORED;
        PaymentTransitions.apply(payment, PaymentStatus.FAILED);
        payments.flush();
        return Outcome.FAILED_APPLIED;
    }

    private Outcome applySuccess(String provider, VerifiedPaymentEvent event, Payment payment, Order order,
            PaymentStatus paymentBefore, OrderStatus orderBefore) {
        if (paymentBefore == PaymentStatus.SUCCESS) {
            if (event.transactionId().equals(payment.getTransactionId())) return Outcome.DUPLICATE;
            anomaly(PaymentAnomalyRecorder.TRANSACTION_CONFLICT, payment, order, paymentBefore, orderBefore, event);
            return Outcome.ANOMALY;
        }
        if (paymentBefore == PaymentStatus.REFUNDED) {
            log.warn("Verified success webhook ignored for refunded payment {}", payment.getId());
            return Outcome.IGNORED;
        }
        if (payments.existsByProviderAndTransactionIdAndIdNot(provider, event.transactionId(), payment.getId())) {
            anomaly(PaymentAnomalyRecorder.TRANSACTION_CONFLICT, payment, order, paymentBefore, orderBefore, event);
            return Outcome.ANOMALY;
        }

        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        PaymentTransitions.apply(payment, PaymentStatus.SUCCESS);
        payment.setTransactionId(event.transactionId());
        // The server clock, never below created_at (the database clock may differ slightly from this JVM).
        payment.setPaidAt(notBefore(now, payment.getCreatedAt()));
        try {
            payments.flush();
        } catch (DataIntegrityViolationException ex) {
            // Another payment took the same transaction id between the check and the write: roll everything back.
            throw new TransactionConflictException(payment.getId(), paymentBefore.name(), orderBefore.name());
        }

        switch (orderBefore) {
            case PENDING_PAYMENT -> {
                // Bowls stay RESERVED even past expires_at (the sweep has not run): the money arrived, so the order is honored.
                order.setStatus(OrderStatus.PAID);
                order.setPaidAt(notBefore(now, order.getCreatedAt()));
                for (Payment other : payments.findForUpdateByOrderIdAndStatus(order.getId(), PaymentStatus.PENDING)) {
                    PaymentTransitions.apply(other, PaymentStatus.EXPIRED);
                    events.publishEvent(new PaymentExpiredEvent(other.getProvider(), other.getPaymentReference(), REASON_ORDER_PAID));
                }
                orders.flush();
                payments.flush();
                return Outcome.SUCCESS_APPLIED;
            }
            case CANCELLED -> {
                // No re-reservation and no automatic refund: the payment is recorded and a human decides.
                anomaly(PaymentAnomalyRecorder.LATE, payment, order, paymentBefore, orderBefore, event);
                return Outcome.ANOMALY;
            }
            default -> {
                anomaly(PaymentAnomalyRecorder.DUPLICATE, payment, order, paymentBefore, orderBefore, event);
                return Outcome.ANOMALY;
            }
        }
    }

    private void anomaly(String action, Payment payment, Order order, PaymentStatus paymentBefore, OrderStatus orderBefore,
            VerifiedPaymentEvent event) {
        var factory = JsonNodeFactory.instance;
        ObjectNode before = factory.objectNode().put("paymentStatus", paymentBefore.name()).put("orderStatus", orderBefore.name());
        ObjectNode after = factory.objectNode().put("paymentStatus", payment.getStatus().name()).put("orderStatus", order.getStatus().name())
                .put("transactionId", event.transactionId());
        after.put("amountReceived", event.amount() == null ? null : event.amount().toPlainString());
        after.put("amountExpected", payment.getAmount().toPlainString());
        anomalies.record(action, payment.getId(), before, after);
    }

    private static Instant notBefore(Instant candidate, Instant floor) {
        return floor != null && candidate.isBefore(floor) ? floor : candidate;
    }
}
