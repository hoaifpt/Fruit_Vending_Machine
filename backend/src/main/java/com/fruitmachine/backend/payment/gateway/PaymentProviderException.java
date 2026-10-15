package com.fruitmachine.backend.payment.gateway;

/** Provider unreachable, timed out or rejected the request. The message is safe to log; no provider bodies. */
public class PaymentProviderException extends RuntimeException {
    public PaymentProviderException(String message) {
        super(message);
    }

    public PaymentProviderException(String message, Throwable cause) {
        super(message, cause);
    }
}
