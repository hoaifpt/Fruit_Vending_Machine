package com.fruitmachine.backend.payment.service;

/**
 * Published inside the transaction that moved a payment from PENDING to EXPIRED. The provider-side cancellation is
 * triggered only after that transaction commits; a rollback discards the event.
 */
public record PaymentExpiredEvent(String provider, String paymentReference, String reason) {
}
