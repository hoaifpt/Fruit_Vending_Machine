package com.fruitmachine.backend.order.service;

import com.fruitmachine.backend.config.properties.OrderProperties;
import com.fruitmachine.backend.order.entity.Order;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.order.repository.OrderRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Releases reservations of unpaid orders past expires_at; each order runs in its own transaction. */
@Slf4j
@Service
@EnableConfigurationProperties(OrderProperties.class)
public class OrderExpiryService {
    private final OrderRepository orders;
    private final OrderReservationService reservations;
    private final OrderProperties properties;
    private final Clock clock;
    private final TransactionTemplate transaction;

    public OrderExpiryService(OrderRepository orders, OrderReservationService reservations, OrderProperties properties,
            Clock clock, PlatformTransactionManager transactionManager) {
        this.orders = orders;
        this.reservations = reservations;
        this.properties = properties;
        this.clock = clock;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    /** Expires one batch of due orders and returns how many were released. A failing order never blocks the others. */
    public int sweep() {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        List<UUID> due = orders.findExpiredIds(OrderStatus.PENDING_PAYMENT, now, PageRequest.of(0, properties.expirySweep().batchSize()));
        int released = 0;
        for (UUID id : due) {
            try {
                if (Boolean.TRUE.equals(transaction.execute(status -> expire(id)))) released++;
            } catch (RuntimeException ex) {
                // Never log request data or secrets; the order id is an internal identifier.
                log.warn("Could not expire order {}: {}", id, ex.getClass().getSimpleName());
            }
        }
        return released;
    }

    private boolean expire(UUID id) {
        // Lock then recheck: a concurrent cancel, payment or second instance may already have handled the order.
        Order order = orders.findForUpdateById(id).orElse(null);
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        if (order == null || order.getStatus() != OrderStatus.PENDING_PAYMENT
                || order.getExpiresAt() == null || order.getExpiresAt().isAfter(now)) {
            return false;
        }
        reservations.release(order, OrderReservationService.REASON_EXPIRED, now);
        return true;
    }
}
