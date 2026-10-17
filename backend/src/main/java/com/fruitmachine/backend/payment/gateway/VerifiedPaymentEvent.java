package com.fruitmachine.backend.payment.gateway;

import java.math.BigDecimal;

/** A provider notification whose authenticity was verified; the payment layer still validates reference and amount. */
public record VerifiedPaymentEvent(Type type, String paymentReference, String transactionId, BigDecimal amount) {
    public enum Type { SUCCESS, FAILED }
}
