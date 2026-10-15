package com.fruitmachine.backend.payment.service;

import com.fruitmachine.backend.payment.entity.Payment;
import com.fruitmachine.backend.payment.enums.PaymentStatus;
import java.util.Map;
import java.util.Set;

/**
 * The only legal payment transitions of this issue. PENDING to SUCCESS (verified webhook) and
 * SUCCESS to REFUNDED belong to later issues and are deliberately absent.
 */
final class PaymentTransitions {
    private static final Map<PaymentStatus, Set<PaymentStatus>> ALLOWED = Map.of(PaymentStatus.PENDING, Set.of(PaymentStatus.FAILED, PaymentStatus.EXPIRED));

    private PaymentTransitions() {
    }

    static void apply(Payment payment, PaymentStatus target) {
        if (!ALLOWED.getOrDefault(payment.getStatus(), Set.of()).contains(target)) {
            throw new IllegalStateException("Illegal payment transition " + payment.getStatus() + " to " + target);
        }
        payment.setStatus(target);
    }
}
