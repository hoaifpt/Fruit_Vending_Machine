package com.fruitmachine.backend.payment.service;

import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.config.properties.PaymentProperties;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.order.repository.OrderRepository;
import com.fruitmachine.backend.payment.dto.KioskPaymentResponse;
import com.fruitmachine.backend.payment.entity.Payment;
import com.fruitmachine.backend.payment.enums.PaymentStatus;
import com.fruitmachine.backend.payment.gateway.PaymentGateway;
import com.fruitmachine.backend.payment.gateway.ProviderPaymentRequest;
import com.fruitmachine.backend.payment.gateway.ProviderPaymentResult;
import com.fruitmachine.backend.payment.mapper.PaymentMapper;
import com.fruitmachine.backend.payment.repository.PaymentRepository;
import com.fruitmachine.backend.security.kiosk.AuthenticatedKiosk;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Steps 1 and 3 of attempt creation. They are separate transactional methods on their own bean so that the
 * orchestrating service calls them through the Spring proxy with the provider call in between, outside any transaction.
 * Lock order is always Order, then Payment.
 */
@Component
@RequiredArgsConstructor
public class PaymentAttemptTransactions {
    private static final int MAX_REFERENCE_ATTEMPTS = 3;

    public sealed interface Prepared permits Reused, Created {
    }

    /** An existing live attempt is returned as is. */
    public record Reused(KioskPaymentResponse payment) implements Prepared {
    }

    /** A new PENDING attempt without QR; the provider still has to be called. */
    public record Created(UUID paymentId, UUID orderId, ProviderPaymentRequest request) implements Prepared {
    }

    public enum Outcome { CREATED, SUPERSEDED, PROVIDER_FAILED }

    public record Completion(Outcome outcome, KioskPaymentResponse payment) {
    }

    private final OrderRepository orders;
    private final PaymentRepository payments;
    private final PaymentProperties properties;
    private final PaymentMapper mapper;
    private final Clock clock;
    private final ApplicationEventPublisher events;

    /** STEP 1. Validates the order, expires stale attempts, and either reuses a live attempt or inserts a new PENDING one. */
    @Transactional
    public Prepared prepare(AuthenticatedKiosk kiosk, UUID orderId, PaymentGateway gateway) {
        var order = orders.findForUpdateByIdAndMachineId(orderId, kiosk.machineId()).orElseThrow(() -> new ResourceNotFoundException("Order not found"));
        if (order.getStatus() != OrderStatus.PENDING_PAYMENT) throw new ConflictException("Order is not awaiting payment");
        Instant now = now();
        if (order.getExpiresAt() == null || !now.isBefore(order.getExpiresAt().minus(properties.minRemainingHold()))) {
            throw new ConflictException("Order reservation is about to expire; payment can no longer be started");
        }
        var attempts = payments.findForUpdateByOrderId(order.getId());
        for (Payment attempt : attempts) {
            if (attempt.getStatus() == PaymentStatus.PENDING && attempt.getExpiredAt() != null && !attempt.getExpiredAt().isAfter(now)) {
                PaymentTransitions.apply(attempt, PaymentStatus.EXPIRED);
                // The attempt is replaced below; its provider link is cancelled only after this transaction commits.
                events.publishEvent(new PaymentExpiredEvent(attempt.getProvider(), attempt.getPaymentReference(), PaymentService.REASON_ATTEMPT_EXPIRED));
            }
        }
        for (Payment attempt : attempts) {
            if (attempt.getStatus() != PaymentStatus.PENDING) continue;
            if (attempt.getQrCode() != null) return new Reused(mapper.kiosk(attempt));
            throw new ConflictException("A payment attempt is already being created; retry shortly");
        }
        if (attempts.size() >= properties.maxAttemptsPerOrder()) throw new ConflictException("Maximum payment attempts reached for this order");
        // Money is never rounded: an amount the provider cannot charge exactly is rejected before any attempt exists.
        if (!gateway.supportsAmount(order.getTotalAmount())) throw new ConflictException("The order amount cannot be charged by the payment provider");

        var payment = new Payment();
        payment.setOrder(order);
        payment.setProvider(gateway.provider());
        payment.setPaymentReference(newReference(gateway));
        payment.setStatus(PaymentStatus.PENDING);
        // The amount is always the order total, never client input.
        payment.setAmount(order.getTotalAmount());
        // A QR must never outlive the inventory reservation.
        Instant deadline = now.plus(properties.attemptTtl());
        payment.setExpiredAt(order.getExpiresAt().isBefore(deadline) ? order.getExpiresAt() : deadline);
        payments.saveAndFlush(payment);
        return new Created(payment.getId(), order.getId(), new ProviderPaymentRequest(payment.getPaymentReference(), order.getOrderCode(),
                payment.getAmount(), "Order " + order.getOrderCode(), payment.getExpiredAt()));
    }

    /** STEP 3. Records the provider outcome unless the attempt was superseded (for example the order was cancelled meanwhile). */
    @Transactional
    public Completion complete(UUID orderId, UUID paymentId, ProviderPaymentResult result) {
        orders.findForUpdateById(orderId).orElseThrow(() -> new ResourceNotFoundException("Order not found"));
        var payment = payments.findForUpdateByIdAndOrderId(paymentId, orderId).orElseThrow(() -> new ResourceNotFoundException("Payment not found"));
        if (payment.getStatus() != PaymentStatus.PENDING) return new Completion(Outcome.SUPERSEDED, null);
        Instant now = now();
        boolean usable = result != null && result.qrCode() != null && !result.qrCode().isBlank()
                && (result.providerExpiresAt() == null || result.providerExpiresAt().isAfter(now));
        if (!usable) {
            PaymentTransitions.apply(payment, PaymentStatus.FAILED);
            payments.flush();
            return new Completion(Outcome.PROVIDER_FAILED, null);
        }
        payment.setQrCode(result.qrCode());
        // PostgreSQL stores microseconds; truncate so the response equals what is persisted.
        Instant providerDeadline = result.providerExpiresAt() == null ? null : result.providerExpiresAt().truncatedTo(ChronoUnit.MICROS);
        if (providerDeadline != null && providerDeadline.isBefore(payment.getExpiredAt())) {
            payment.setExpiredAt(providerDeadline);
        }
        payments.flush();
        return new Completion(Outcome.CREATED, mapper.kiosk(payment));
    }

    private String newReference(PaymentGateway gateway) {
        for (int attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt++) {
            String reference = gateway.newPaymentReference();
            if (!payments.existsByProviderAndPaymentReference(gateway.provider(), reference)) return reference;
        }
        // The unique index remains the final guard; this only avoids a pointless insert.
        throw new ConflictException("Could not allocate a unique payment reference");
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }
}
