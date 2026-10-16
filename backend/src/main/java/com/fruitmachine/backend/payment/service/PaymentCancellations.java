package com.fruitmachine.backend.payment.service;

import com.fruitmachine.backend.payment.gateway.PaymentGatewayRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Best-effort provider-side invalidation of expired attempts. It never runs inside a database transaction, never retries
 * and never changes backend state: EXPIRED stays authoritative whatever the provider answers.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PaymentCancellations {
    private final PaymentGatewayRegistry gateways;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onExpired(PaymentExpiredEvent event) {
        cancelBestEffort(event.provider(), event.paymentReference(), event.reason());
    }

    public void cancelBestEffort(String provider, String paymentReference, String reason) {
        var gateway = gateways.active();
        // Attempts created under another provider (for example MOCK before a switch) are not ours to cancel.
        if (paymentReference == null || !gateway.provider().equals(provider)) return;
        try {
            gateway.cancelPayment(paymentReference, reason);
        } catch (RuntimeException ex) {
            log.warn("Provider-side cancellation failed for payment reference {}: {}", paymentReference, ex.getClass().getSimpleName());
        }
    }
}
