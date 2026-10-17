package com.fruitmachine.backend.payment.gateway;

/**
 * Outcome of verifying a webhook. referenceHint and signature are untrusted values kept for the evidence log only.
 * event is null unless the request was verified AND carries an actionable payment event.
 */
public record WebhookVerificationResult(boolean verified, String eventType, String referenceHint, String signature,
        VerifiedPaymentEvent event) {
    public static final String UNKNOWN = "UNKNOWN";

    /** Not authentic (or not understood): nothing may change because of it. */
    public static WebhookVerificationResult rejected(String referenceHint, String signature) {
        return new WebhookVerificationResult(false, UNKNOWN, referenceHint, signature, null);
    }
}
