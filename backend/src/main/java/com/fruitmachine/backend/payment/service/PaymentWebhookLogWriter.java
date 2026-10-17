package com.fruitmachine.backend.payment.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.payment.entity.PaymentWebhookLog;
import com.fruitmachine.backend.payment.gateway.WebhookVerificationResult;
import com.fruitmachine.backend.payment.repository.PaymentWebhookLogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Persists every webhook attempt in its own transaction, so the evidence of what the provider sent survives even when the
 * business processing rolls back. The raw body and signature are stored here and never written to application logs.
 */
@Component
@RequiredArgsConstructor
public class PaymentWebhookLogWriter {
    static final int EVENT_TYPE_MAX = 100;
    static final int REFERENCE_MAX = 64;
    private final PaymentWebhookLogRepository logs;
    private final ObjectMapper mapper;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String provider, String rawBody, WebhookVerificationResult result) {
        var row = new PaymentWebhookLog();
        row.setProvider(provider);
        // PostgreSQL text cannot hold NUL; it is the only character that cannot be stored verbatim.
        row.setRawBody(rawBody.indexOf('\u0000') < 0 ? rawBody : rawBody.replace('\u0000', '\uFFFD'));
        row.setRawPayload(parseJson(rawBody));
        row.setSignature(result.signature() == null || result.signature().indexOf('\u0000') >= 0 ? null : result.signature());
        row.setVerified(result.verified());
        row.setEventType(clean(result.eventType(), EVENT_TYPE_MAX, true));
        // order_code stores the untrusted PROVIDER reference hint, not orders.order_code; longer values are dropped, not cut.
        row.setOrderCode(clean(result.referenceHint(), REFERENCE_MAX, false));
        logs.saveAndFlush(row);
    }

    private JsonNode parseJson(String rawBody) {
        try {
            JsonNode node = mapper.readTree(rawBody);
            return node == null || node.isMissingNode() ? null : node;
        } catch (Exception ex) {
            return null;
        }
    }

    private static String clean(String value, int max, boolean truncate) {
        if (value == null || value.isBlank() || value.indexOf('\u0000') >= 0) return null;
        if (value.length() <= max) return value;
        return truncate ? value.substring(0, max) : null;
    }
}
