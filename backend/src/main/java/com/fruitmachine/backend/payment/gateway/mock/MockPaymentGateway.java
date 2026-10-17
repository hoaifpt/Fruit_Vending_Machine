package com.fruitmachine.backend.payment.gateway.mock;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fruitmachine.backend.payment.gateway.HmacSha256;
import com.fruitmachine.backend.payment.gateway.PaymentGateway;
import com.fruitmachine.backend.payment.gateway.ProviderPaymentRequest;
import com.fruitmachine.backend.payment.gateway.ProviderPaymentResult;
import com.fruitmachine.backend.payment.gateway.VerifiedPaymentEvent;
import com.fruitmachine.backend.payment.gateway.WebhookVerificationResult;
import java.math.BigDecimal;
import java.security.SecureRandom;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;

/**
 * Development/test provider: no network and no real money. Webhooks are authenticated with an HMAC-SHA256 of the raw body under
 * app.payment.mock.webhook-secret, sent in X-Mock-Signature. Rejected as the active provider in the prod profile.
 */
@Component
@EnableConfigurationProperties(MockPaymentProperties.class)
public class MockPaymentGateway implements PaymentGateway {
    public static final String PROVIDER = "MOCK";
    public static final String SIGNATURE_HEADER = "X-Mock-Signature";
    /** Exact decimal numbers so the amount the signer saw is the amount that is compared. */
    private static final ObjectMapper RAW = new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
            .setNodeFactory(JsonNodeFactory.withExactBigDecimals(true));
    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final MockPaymentProperties properties;

    public MockPaymentGateway(MockPaymentProperties properties) {
        this.properties = properties;
    }

    @Override
    public String provider() {
        return PROVIDER;
    }

    @Override
    public String newPaymentReference() {
        var reference = new StringBuilder("MOCK-");
        for (int i = 0; i < 8; i++) reference.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        return reference.toString();
    }

    @Override
    public ProviderPaymentResult createPayment(ProviderPaymentRequest request) {
        return new ProviderPaymentResult("MOCK-QR|" + request.paymentReference() + "|" + request.amount().toPlainString(), null);
    }

    @Override
    public WebhookVerificationResult verifyWebhook(String rawBody, HttpHeaders headers) {
        String received = headers == null ? null : headers.getFirst(SIGNATURE_HEADER);
        JsonNode body = parse(rawBody);
        String hint = body == null || !body.path("paymentReference").isTextual() ? null : body.path("paymentReference").asText();
        String secret = properties.webhookSecret();
        // A blank secret never verifies, so an unconfigured MOCK endpoint cannot be used to mark anything paid.
        boolean authentic = rawBody != null && secret != null && !secret.isBlank()
                && HmacSha256.constantTimeEquals(HmacSha256.hex(secret, rawBody), received);
        if (!authentic || body == null || !body.isObject()) return WebhookVerificationResult.rejected(hint, received);

        String status = body.path("status").isTextual() ? body.path("status").asText() : "";
        VerifiedPaymentEvent.Type type = switch (status) {
            case "SUCCESS" -> VerifiedPaymentEvent.Type.SUCCESS;
            case "FAILED" -> VerifiedPaymentEvent.Type.FAILED;
            default -> null;
        };
        if (type == null) return new WebhookVerificationResult(true, WebhookVerificationResult.UNKNOWN, hint, received, null);
        String eventType = type == VerifiedPaymentEvent.Type.SUCCESS ? "PAYMENT_SUCCESS" : "PAYMENT_FAILED";
        String transactionId = body.path("transactionId").isTextual() ? body.path("transactionId").asText() : null;
        BigDecimal amount = body.path("amount").isNumber() ? body.path("amount").decimalValue() : null;
        boolean actionable = hint != null && !hint.isBlank()
                && (type == VerifiedPaymentEvent.Type.FAILED || (transactionId != null && !transactionId.isBlank() && amount != null));
        return new WebhookVerificationResult(true, eventType, hint, received,
                actionable ? new VerifiedPaymentEvent(type, hint, transactionId, amount) : null);
    }

    private static JsonNode parse(String rawBody) {
        try {
            return rawBody == null ? null : RAW.readTree(rawBody);
        } catch (Exception ex) {
            return null;
        }
    }
}
