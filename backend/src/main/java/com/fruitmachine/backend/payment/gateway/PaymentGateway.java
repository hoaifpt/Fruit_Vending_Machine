package com.fruitmachine.backend.payment.gateway;

/**
 * Provider-independent payment boundary. Provider specifics (reference rules, QR format, credentials) stay
 * behind this interface. Webhook verification is added by the webhook issue, not here.
 */
public interface PaymentGateway {
    /** Uppercase provider code stored in payments.provider, for example MOCK or PAYOS. */
    String provider();

    /** Provider-compatible unique reference for a new attempt. */
    String newPaymentReference();

    /** Calls the provider. Must never be invoked inside a database transaction. */
    ProviderPaymentResult createPayment(ProviderPaymentRequest request);
}
