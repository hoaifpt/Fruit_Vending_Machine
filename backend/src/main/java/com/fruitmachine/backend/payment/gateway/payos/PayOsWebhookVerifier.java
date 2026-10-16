package com.fruitmachine.backend.payment.gateway.payos;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.springframework.stereotype.Component;

/**
 * Verifies the HMAC-SHA256 signature of a payOS webhook from the exact raw body. The data object is canonicalized from the
 * values as received (exact numbers), compared in constant time, and any malformed input simply fails verification.
 * Wiring this into an endpoint is the job of the webhook issue.
 */
@Component
public class PayOsWebhookVerifier {
    /** Exact decimal numbers (12.50 stays 12.50); plain parsing of the raw body, never a re-serialized Java object. */
    static final ObjectMapper RAW = new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
            .setNodeFactory(JsonNodeFactory.withExactBigDecimals(true));

    private final PayOsProperties properties;

    public PayOsWebhookVerifier(PayOsProperties properties) {
        this.properties = properties;
    }

    public boolean verify(String rawBody) {
        try {
            String key = properties.checksumKey();
            if (rawBody == null || key == null || key.isBlank()) return false;
            JsonNode root = RAW.readTree(rawBody);
            if (root == null || !root.isObject()) return false;
            JsonNode data = root.get("data");
            JsonNode signature = root.get("signature");
            if (data == null || !data.isObject() || signature == null || !signature.isTextual() || signature.asText().isBlank()) return false;
            String expected = PayOsSignature.hmacSha256Hex(key, PayOsSignature.canonicalize(data));
            return PayOsSignature.constantTimeEquals(expected, signature.asText());
        } catch (Exception ex) {
            // Malformed JSON or anything unexpected is simply an unverified webhook; nothing leaks outward.
            return false;
        }
    }
}
