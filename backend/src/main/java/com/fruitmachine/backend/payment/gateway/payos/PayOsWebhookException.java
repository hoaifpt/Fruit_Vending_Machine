package com.fruitmachine.backend.payment.gateway.payos;

/** A webhook body that cannot be understood. The message never contains the body. */
public class PayOsWebhookException extends RuntimeException {
    public PayOsWebhookException(String message) {
        super(message);
    }
}
