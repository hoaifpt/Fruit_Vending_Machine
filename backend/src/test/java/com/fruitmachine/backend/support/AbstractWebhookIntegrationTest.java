package com.fruitmachine.backend.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.payment.gateway.HmacSha256;
import java.math.BigDecimal;
import java.util.UUID;
import org.springframework.test.web.servlet.MvcResult;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Webhook fixtures on top of the payment fixtures. TESTPAY is the active provider and verifies webhooks with the MOCK scheme:
 * header X-Mock-Signature = hex HMAC-SHA256 of the exact raw body under ControllableGateway.WEBHOOK_SECRET.
 */
public abstract class AbstractWebhookIntegrationTest extends AbstractPaymentIntegrationTest {
    protected static final String WEBHOOK = "/api/v1/webhooks/payments/testpay";

    protected static String sign(String rawBody) {
        return HmacSha256.hex(ControllableGateway.WEBHOOK_SECRET, rawBody);
    }

    protected static String webhookBody(String reference, String transactionId, String amount, String status) {
        return "{\"paymentReference\":\"" + reference + "\",\"transactionId\":" + (transactionId == null ? "null" : "\"" + transactionId + "\"")
                + ",\"amount\":" + amount + ",\"status\":\"" + status + "\"}";
    }

    protected MvcResult webhook(String path, String rawBody, String signature) throws Exception {
        var request = post(path).contentType("application/json").content(rawBody);
        if (signature != null) request.header("X-Mock-Signature", signature);
        return mvc.perform(request).andReturn();
    }

    protected int send(String rawBody) throws Exception {
        return webhook(WEBHOOK, rawBody, sign(rawBody)).getResponse().getStatus();
    }

    protected int paid(String reference, String transactionId, String amount) throws Exception {
        return send(webhookBody(reference, transactionId, amount, "SUCCESS"));
    }

    protected String referenceOf(UUID orderId) {
        return jdbc.queryForObject("SELECT payment_reference FROM payments WHERE order_id=? ORDER BY created_at DESC, id DESC LIMIT 1", String.class, orderId);
    }

    protected String paymentStatus(String reference) {
        return jdbc.queryForObject("SELECT status FROM payments WHERE payment_reference=?", String.class, reference);
    }

    protected long auditCount(String action, UUID paymentId) {
        return jdbc.queryForObject("SELECT count(*) FROM audit_logs WHERE action=? AND entity_type='Payment' AND entity_id=?", Long.class, action, paymentId);
    }

    protected UUID paymentId(String reference) {
        return jdbc.queryForObject("SELECT id FROM payments WHERE payment_reference=?", UUID.class, reference);
    }

    protected long logCount(String reference) {
        return jdbc.queryForObject("SELECT count(*) FROM payment_webhook_logs WHERE order_code=?", Long.class, reference);
    }

    protected String orderTotal(UUID orderId) {
        return jdbc.queryForObject("SELECT total_amount FROM orders WHERE id=?", BigDecimal.class, orderId).toPlainString();
    }

    protected JsonNode kioskOrder(PlacedOrder order) throws Exception {
        return kioskData("GET", order.order(), order.shop().key(), null, 200);
    }

    /** Runs the tasks at the same moment on separate threads (separate database connections) and returns their results. */
    protected <T> java.util.List<T> parallel(java.util.List<java.util.concurrent.Callable<T>> tasks) throws Exception {
        var pool = java.util.concurrent.Executors.newFixedThreadPool(tasks.size());
        try {
            var ready = new java.util.concurrent.CountDownLatch(tasks.size());
            var go = new java.util.concurrent.CountDownLatch(1);
            var futures = new java.util.ArrayList<java.util.concurrent.Future<T>>();
            for (var task : tasks) futures.add(pool.submit(() -> { ready.countDown(); go.await(); return task.call(); }));
            org.assertj.core.api.Assertions.assertThat(ready.await(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            go.countDown();
            var results = new java.util.ArrayList<T>();
            for (var future : futures) results.add(future.get(60, java.util.concurrent.TimeUnit.SECONDS));
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    /** An extra PENDING attempt of the order, as if an earlier QR were still payable. */
    protected String insertPendingAttempt(UUID orderId, String reference, String amount) {
        jdbc.update("INSERT INTO payments(order_id, provider, payment_reference, amount, status, qr_code, expired_at) VALUES (?, 'TESTPAY', ?, ?::numeric, 'PENDING', 'TEST-QR|x', now() + interval '1 minute')",
                orderId, reference, amount);
        return reference;
    }

    protected JsonNode auditValue(String action, UUID paymentId, String column) throws Exception {
        String text = jdbc.queryForObject("SELECT " + column + "::text FROM audit_logs WHERE action=? AND entity_id=? ORDER BY created_at DESC LIMIT 1", String.class, action, paymentId);
        return json.readTree(text);
    }
}
