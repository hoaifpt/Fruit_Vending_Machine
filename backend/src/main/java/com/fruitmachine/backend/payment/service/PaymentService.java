package com.fruitmachine.backend.payment.service;

import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.config.properties.PaymentProperties;
import com.fruitmachine.backend.order.entity.Order;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.payment.dto.KioskPaymentResponse;
import com.fruitmachine.backend.payment.dto.PaymentDetailResponse;
import com.fruitmachine.backend.payment.dto.PaymentPageResponse;
import com.fruitmachine.backend.payment.entity.Payment;
import com.fruitmachine.backend.payment.enums.PaymentStatus;
import com.fruitmachine.backend.payment.gateway.PaymentGatewayRegistry;
import com.fruitmachine.backend.payment.gateway.PaymentProviderException;
import com.fruitmachine.backend.payment.gateway.ProviderPaymentRequest;
import com.fruitmachine.backend.payment.gateway.ProviderPaymentResult;
import com.fruitmachine.backend.payment.mapper.PaymentMapper;
import com.fruitmachine.backend.payment.repository.PaymentRepository;
import com.fruitmachine.backend.security.kiosk.AuthenticatedKiosk;
import jakarta.annotation.PreDestroy;
import jakarta.persistence.criteria.Predicate;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Provider-independent payment use cases. Attempt creation is deliberately not transactional: step 1 and step 3 run in
 * {@link PaymentAttemptTransactions} and the provider is called in between with no transaction open.
 */
@Slf4j
@Service
public class PaymentService {
    public static final String REASON_ATTEMPT_EXPIRED = "ATTEMPT_EXPIRED";
    private static final Set<String> SORT_FIELDS = Set.of("createdAt", "amount", "paidAt");

    private final PaymentAttemptTransactions attempts;
    private final PaymentGatewayRegistry gateways;
    private final PaymentRepository payments;
    private final PaymentMapper mapper;
    private final PaymentProperties properties;
    private final PaymentCancellations cancellations;
    private final ApplicationEventPublisher events;
    private final ExecutorService providerCalls = Executors.newVirtualThreadPerTaskExecutor();

    public PaymentService(PaymentAttemptTransactions attempts, PaymentGatewayRegistry gateways, PaymentRepository payments,
            PaymentMapper mapper, PaymentProperties properties, PaymentCancellations cancellations,
            ApplicationEventPublisher events) {
        this.attempts = attempts;
        this.gateways = gateways;
        this.payments = payments;
        this.mapper = mapper;
        this.properties = properties;
        this.cancellations = cancellations;
        this.events = events;
    }

    /** Result of attempt creation: created is false when a live attempt was reused. */
    public record AttemptResult(KioskPaymentResponse payment, boolean created) {
    }

    @PreAuthorize("hasRole('KIOSK')")
    public AttemptResult createOrReuseAttempt(AuthenticatedKiosk kiosk, UUID orderId) {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("Payment attempts must not be created inside a database transaction");
        }
        var gateway = gateways.active();
        var prepared = attempts.prepare(kiosk, orderId, gateway);
        if (prepared instanceof PaymentAttemptTransactions.Reused reused) return new AttemptResult(reused.payment(), false);
        var created = (PaymentAttemptTransactions.Created) prepared;

        ProviderPaymentResult result = null;
        try {
            result = callProvider(gateway, created.request());
        } catch (PaymentProviderException ex) {
            // Never log provider bodies, credentials or the QR payload.
            log.warn("Payment provider call failed for payment {}: {}", created.paymentId(), ex.getMessage());
        }
        var completion = attempts.complete(created.orderId(), created.paymentId(), result);
        return switch (completion.outcome()) {
            case CREATED -> new AttemptResult(completion.payment(), true);
            case SUPERSEDED -> {
                // The order was cancelled while the provider call was in flight: its cancel found no link to invalidate yet,
                // so the link the provider just created is cancelled now (outside any transaction, best effort).
                // A link that was paid meanwhile (SUCCESS) is not cancelled.
                if (completion.finalStatus() == PaymentStatus.EXPIRED) {
                    cancellations.cancelBestEffort(gateway.provider(), created.request().paymentReference(), "ORDER_CANCELLED");
                }
                throw new ConflictException("Order is no longer awaiting payment; the attempt was not kept");
            }
            case PROVIDER_FAILED -> throw new PaymentProviderException("Payment provider could not create the payment");
        };
    }

    /** Called by the order release workflow after it locked the order: PENDING attempts become EXPIRED. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void expirePendingPayments(Order order, String reason) {
        for (Payment pending : payments.findForUpdateByOrderIdAndStatus(order.getId(), PaymentStatus.PENDING)) {
            PaymentTransitions.apply(pending, PaymentStatus.EXPIRED);
            events.publishEvent(new PaymentExpiredEvent(pending.getProvider(), pending.getPaymentReference(), reason));
        }
        payments.flush();
    }

    @Transactional(readOnly = true)
    @PreAuthorize("hasRole('ADMIN')")
    public PaymentPageResponse listPayments(int page, int size, PaymentStatus status, String provider, UUID orderId, UUID machineId,
            Instant createdFrom, Instant createdTo, Boolean requiresAttention, String sort) {
        Specification<Payment> filter = (root, query, cb) -> {
            var predicates = new ArrayList<Predicate>();
            if (status != null) predicates.add(cb.equal(root.get("status"), status));
            if (provider != null && !provider.isBlank()) predicates.add(cb.equal(root.get("provider"), provider.strip().toUpperCase(Locale.ROOT)));
            if (orderId != null) predicates.add(cb.equal(root.get("order").get("id"), orderId));
            if (machineId != null) predicates.add(cb.equal(root.get("order").get("machine").get("id"), machineId));
            if (createdFrom != null) predicates.add(cb.greaterThanOrEqualTo(root.get("createdAt"), createdFrom));
            if (createdTo != null) predicates.add(cb.lessThan(root.get("createdAt"), createdTo));
            if (Boolean.TRUE.equals(requiresAttention)) {
                // Derived, no column: a SUCCESS payment whose order was CANCELLED (late payment) or that shares its order with
                // another SUCCESS payment (duplicate payment). Amount mismatches leave the payment unchanged and are found in audit_logs.
                var other = query.subquery(Long.class);
                var sibling = other.from(Payment.class);
                other.select(cb.literal(1L)).where(cb.equal(sibling.get("order"), root.get("order")),
                        cb.equal(sibling.get("status"), PaymentStatus.SUCCESS), cb.notEqual(sibling.get("id"), root.get("id")));
                predicates.add(cb.equal(root.get("status"), PaymentStatus.SUCCESS));
                predicates.add(cb.or(cb.equal(root.get("order").get("status"), OrderStatus.CANCELLED), cb.exists(other)));
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        };
        var result = payments.findAll(filter, pageRequest(page, size, sort));
        return new PaymentPageResponse(result.getContent().stream().map(mapper::response).toList(), page, size,
                result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    @PreAuthorize("hasRole('ADMIN')")
    public PaymentDetailResponse getPayment(UUID id) {
        return mapper.detail(payments.findWithOrderById(id).orElseThrow(() -> new ResourceNotFoundException("Payment not found")));
    }

    private ProviderPaymentResult callProvider(com.fruitmachine.backend.payment.gateway.PaymentGateway gateway, ProviderPaymentRequest request) {
        Future<ProviderPaymentResult> call = providerCalls.submit(() -> gateway.createPayment(request));
        try {
            return call.get(properties.providerTimeout().toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException ex) {
            call.cancel(true);
            throw new PaymentProviderException("Payment provider timed out", ex);
        } catch (ExecutionException ex) {
            throw new PaymentProviderException("Payment provider rejected the request", ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            call.cancel(true);
            throw new PaymentProviderException("Payment provider call interrupted", ex);
        }
    }

    private PageRequest pageRequest(int page, int size, String input) {
        if (page < 0 || size < 1 || size > 100) throw new BadRequestException("Page must be nonnegative and size between 1 and 100");
        String[] parts = (input == null ? "createdAt,desc" : input).split(",", -1);
        if (parts.length > 2 || !SORT_FIELDS.contains(parts[0])
                || (parts.length == 2 && !Set.of("asc", "desc").contains(parts[1].toLowerCase(Locale.ROOT)))) {
            throw new BadRequestException("Invalid payment sort");
        }
        Sort.Direction direction = parts.length == 2 && parts[1].equalsIgnoreCase("desc") ? Sort.Direction.DESC : Sort.Direction.ASC;
        return PageRequest.of(page, size, Sort.by(direction, parts[0]).and(Sort.by("id")));
    }

    @PreDestroy
    void shutdown() {
        providerCalls.shutdownNow();
    }
}
