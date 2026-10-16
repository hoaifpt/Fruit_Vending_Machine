package com.fruitmachine.backend.payment.gateway;

import java.math.BigDecimal;

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

    /** Whether this provider can charge the given amount exactly; money is never rounded silently. */
    default boolean supportsAmount(BigDecimal amount) {
        return amount != null && amount.signum() > 0;
    }

    /**
     * Best-effort provider-side invalidation of an attempt that the backend already expired. Called only after the
     * transaction that expired it committed. Must not throw for provider failures; the backend state stays authoritative.
     */
    default void cancelPayment(String paymentReference, String reason) {
    }

    /** Called once at startup for the active gateway; throws IllegalStateException (never including secret values). */
    default void validateConfiguration() {
    }
}
