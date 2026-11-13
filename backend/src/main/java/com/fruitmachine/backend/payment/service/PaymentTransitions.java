package com.fruitmachine.backend.payment.service;

import com.fruitmachine.backend.payment.entity.Payment;
import com.fruitmachine.backend.payment.enums.PaymentStatus;
import java.util.Map;
import java.util.Set;

/**
 * The only legal payment transitions. PENDING can fail or expire from the attempt lifecycle; SUCCESS is applied exclusively by the
 * verified webhook flow. SUCCESS to REFUNDED (issue #72) is applied exclusively by the refund flow through {@link #refund(Payment)}
 * and is not reachable through {@link #apply}; REFUNDED is final.
 */
public final class PaymentTransitions {
    // SUCCESS is reachable from every non-terminal state because the money really arrived, even for a FAILED or EXPIRED attempt.
    // Only the verified webhook flow applies it; REFUNDED is reached only through refund().
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

    /** SUCCESS -> REFUNDED; called only by RefundService after its own checks and under the Order -> Payment locks. */
    public static void refund(Payment payment) {
        if (payment.getStatus() != PaymentStatus.SUCCESS) {
            throw new IllegalStateException("Illegal payment transition " + payment.getStatus() + " to " + PaymentStatus.REFUNDED);
        }
        payment.setStatus(PaymentStatus.REFUNDED);
    }
}
