package com.fruitmachine.backend.payment.service;

import java.util.UUID;

/**
 * Thrown inside the confirmation transaction when the provider transaction id is already used by another payment. It rolls the
 * business transaction back; the caller records the anomaly in a new transaction.
 */
public class TransactionConflictException extends RuntimeException {
    private final UUID paymentId;
    private final String paymentStatus;
    private final String orderStatus;

    public TransactionConflictException(UUID paymentId, String paymentStatus, String orderStatus) {
        super("Provider transaction id is already used by another payment");
        this.paymentId = paymentId;
        this.paymentStatus = paymentStatus;
        this.orderStatus = orderStatus;
    }

    public UUID paymentId() { return paymentId; }
    public String paymentStatus() { return paymentStatus; }
    public String orderStatus() { return orderStatus; }
}
