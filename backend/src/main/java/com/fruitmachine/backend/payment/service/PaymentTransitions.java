package com.fruitmachine.backend.payment.service;

import com.fruitmachine.backend.payment.entity.Payment;
import com.fruitmachine.backend.payment.enums.PaymentStatus;
import java.util.Map;
import java.util.Set;

/**
 * The only legal payment transitions. PENDING can fail or expire from the attempt lifecycle; SUCCESS is applied exclusively by the
 * verified webhook flow. SUCCESS to REFUNDED belongs to a later issue and is deliberately absent.
 */
final class PaymentTransitions {
    // SUCCESS is reachable from every non-terminal state because the money really arrived, even for a FAILED or EXPIRED attempt.
    // Only the verified webhook flow applies it; REFUNDED stays out of reach until the refund issue.
    private static final Map<PaymentStatus, Set<PaymentStatus>> ALLOWED = Map.of(
            PaymentStatus.PENDING, Set.of(PaymentStatus.FAILED, PaymentStatus.EXPIRED, PaymentStatus.SUCCESS),
            PaymentStatus.FAILED, Set.of(PaymentStatus.SUCCESS),
            PaymentStatus.EXPIRED, Set.of(PaymentStatus.SUCCESS));

    private PaymentTransitions() {
    }

    static void apply(Payment payment, PaymentStatus target) {
        if (!ALLOWED.getOrDefault(payment.getStatus(), Set.of()).contains(target)) {
            throw new IllegalStateException("Illegal payment transition " + payment.getStatus() + " to " + target);
        }
        payment.setStatus(target);
    }
}
