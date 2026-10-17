package com.fruitmachine.backend.payment.gateway;

import java.math.BigDecimal;
import java.util.Map;
import org.springframework.http.HttpHeaders;

/**
 * Provider-independent payment boundary. Provider specifics (reference rules, QR format, credentials) stay
 * behind this interface, including webhook verification.
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

    /**
     * Verifies a webhook from the exact raw body and the received headers. Must never throw for bad input and never trust any part of
     * the request before the provider signature checks out. Providers without webhook support keep this default: nothing is verified.
     */
    default WebhookVerificationResult verifyWebhook(String rawBody, HttpHeaders headers) {
        return WebhookVerificationResult.rejected(null, null);
    }

    /** Acknowledgement body for an accepted webhook; providers retry on non-2xx, so the shape is provider specific. */
    default Object webhookAcknowledgement() {
        return Map.of("success", true);
    }

    /** Called once at startup for the active gateway; throws IllegalStateException (never including secret values). */
    default void validateConfiguration() {
    }
}
