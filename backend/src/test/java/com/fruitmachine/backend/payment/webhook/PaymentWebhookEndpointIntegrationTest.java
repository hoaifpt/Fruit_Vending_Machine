package com.fruitmachine.backend.payment.webhook;

import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

@ExtendWith(OutputCaptureExtension.class)
class PaymentWebhookEndpointIntegrationTest extends AbstractWebhookIntegrationTest {
    private long logs() {
        return count("SELECT count(*) FROM payment_webhook_logs");
    }

    private PlacedOrder payable() throws Exception {
        var order = placeOrder();
        pay(order, 201);
        return order;
    }

    @Test
    void aValidSignatureIsProcessedAndAcknowledgedWith200() throws Exception {
        var order = payable();
        String reference = referenceOf(order.orderId());
        String body = webhookBody(reference, "TXN-OK-1", orderTotal(order.orderId()), "SUCCESS");
        var response = webhook(WEBHOOK, body, sign(body)).getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentAsString()).isEqualTo("{\"success\":true}");
        assertThat(paymentStatus(reference)).isEqualTo("SUCCESS");
        assertThat(orderStatus(order.orderId())).isEqualTo("PAID");
    }

    @Test
    void invalidOrMissingSignaturesAreRejectedWith401AndChangeNothing() throws Exception {
        var order = payable();
        String reference = referenceOf(order.orderId());
        String body = webhookBody(reference, "TXN-BAD-1", orderTotal(order.orderId()), "SUCCESS");
        String good = sign(body);
        for (String signature : new String[]{null, "", "   ", "deadbeef", good.substring(1), good + "0", "0".repeat(64), sign(body + " ")}) {
            var response = webhook(WEBHOOK, body, signature).getResponse();
            assertThat(response.getStatus()).as("signature %s", signature).isEqualTo(401);
            assertThat(response.getContentAsString()).doesNotContain(good, "TXN-BAD-1").contains("Webhook could not be verified");
        }
        assertThat(paymentStatus(reference)).isEqualTo("PENDING");
        assertThat(orderStatus(order.orderId())).isEqualTo("PENDING_PAYMENT");
        assertThat(count("SELECT count(*) FROM audit_logs WHERE entity_id=?", paymentId(reference))).isZero();
    }

    @Test
    void aBodyThatIsNotValidJsonIs401AndIsLoggedWithoutAParsedPayload() throws Exception {
        long before = logs();
        for (String body : new String[]{"not json", "{", "[1,2", "", "{\"paymentReference\":"}) {
            // Even a correctly signed unparsable body cannot be a payment event.
            assertThat(webhook(WEBHOOK, body, sign(body)).getResponse().getStatus()).as("%s", body).isEqualTo(401);
        }
        assertThat(logs()).isEqualTo(before + 5);
        var row = jdbc.queryForMap("SELECT raw_body, raw_payload, is_verified FROM payment_webhook_logs WHERE raw_body='not json'");
        assertThat(row.get("raw_payload")).isNull();
        assertThat(row.get("is_verified")).isEqualTo(false);
    }

    @Test
    void anInactiveOrUnknownProviderPathIs404AndNothingIsLogged() throws Exception {
        long before = logs();
        String body = webhookBody("X", "T", "1", "SUCCESS");
        for (String provider : new String[]{"payos", "mock", "PAYOS", "nope", "testpay2"}) {
            assertThat(webhook("/api/v1/webhooks/payments/" + provider, body, sign(body)).getResponse().getStatus()).as(provider).isEqualTo(404);
        }
        assertThat(logs()).isEqualTo(before);
        // The provider segment is case-insensitive for the active provider.
        assertThat(webhook("/api/v1/webhooks/payments/TestPay", body, sign(body)).getResponse().getStatus()).isEqualTo(200);
    }

    @Test
    void bodiesOverSixtyFourKilobytesAreRejectedWith413AndExactlyTheLimitIsAccepted() throws Exception {
        long before = logs();
        String prefix = "{\"paymentReference\":\"UNKNOWN-REF\",\"transactionId\":\"T\",\"amount\":1,\"status\":\"SUCCESS\",\"pad\":\"";
        String suffix = "\"}";
        int limit = 64 * 1024;
        String exact = prefix + "x".repeat(limit - prefix.length() - suffix.length()) + suffix;
        assertThat(exact.getBytes(StandardCharsets.UTF_8)).hasSize(limit);
        String over = exact + " ";
        var tooLarge = webhook(WEBHOOK, over, sign(over)).getResponse();
        assertThat(tooLarge.getStatus()).isEqualTo(413);
        assertThat(tooLarge.getContentAsString()).doesNotContain("xxxx");
        assertThat(logs()).isEqualTo(before);
        assertThat(webhook(WEBHOOK, exact, sign(exact)).getResponse().getStatus()).isEqualTo(200);
        assertThat(logs()).isEqualTo(before + 1);
    }

    @Test
    void aNonJsonContentTypeIs415AndNothingIsLogged() throws Exception {
        long before = logs();
        String body = webhookBody("X", "T", "1", "SUCCESS");
        for (String type : new String[]{"text/plain", "application/x-www-form-urlencoded", "application/xml"}) {
            var result = mvc.perform(post(WEBHOOK).contentType(type).content(body).header("X-Mock-Signature", sign(body))).andReturn();
            assertThat(result.getResponse().getStatus()).as(type).isEqualTo(415);
        }
        assertThat(mvc.perform(post(WEBHOOK).content(body).header("X-Mock-Signature", sign(body))).andReturn().getResponse().getStatus()).isEqualTo(415);
        assertThat(logs()).isEqualTo(before);
    }

    @Test
    void verificationUsesTheExactRawBytesSoWhitespaceChangesBreakTheSignature() throws Exception {
        var order = payable();
        String reference = referenceOf(order.orderId());
        String compact = webhookBody(reference, "TXN-WS-1", orderTotal(order.orderId()), "SUCCESS");
        String pretty = compact.replace(",", ",\n  ").replace("{", "{\n  ").replace("}", "\n}");
        // Semantically identical JSON, different bytes: the signature of the compact form does not cover it.
        assertThat(webhook(WEBHOOK, pretty, sign(compact)).getResponse().getStatus()).isEqualTo(401);
        assertThat(paymentStatus(reference)).isEqualTo("PENDING");
        assertThat(webhook(WEBHOOK, pretty, sign(pretty)).getResponse().getStatus()).isEqualTo(200);
        assertThat(paymentStatus(reference)).isEqualTo("SUCCESS");
        // Both attempts (rejected, then accepted) are stored with the exact bytes received.
        var stored = jdbc.queryForList("SELECT is_verified FROM payment_webhook_logs WHERE raw_body=? ORDER BY received_at, id", Boolean.class, pretty);
        assertThat(stored).containsExactly(false, true);
    }

    @Test
    void everyAttemptCreatesExactlyOneLogRowWithTheVerificationResult() throws Exception {
        var order = payable();
        String reference = referenceOf(order.orderId());
        long before = logs();
        String valid = webhookBody(reference, "TXN-LOG-1", orderTotal(order.orderId()), "SUCCESS");
        assertThat(webhook(WEBHOOK, valid, sign(valid)).getResponse().getStatus()).isEqualTo(200);
        assertThat(logs()).isEqualTo(before + 1);
        String invalid = webhookBody(reference, "TXN-LOG-2", orderTotal(order.orderId()), "SUCCESS");
        assertThat(webhook(WEBHOOK, invalid, "bad").getResponse().getStatus()).isEqualTo(401);
        assertThat(logs()).isEqualTo(before + 2);
        String unknown = webhookBody("NO-SUCH-PAYMENT", "TXN-LOG-3", "10", "SUCCESS");
        assertThat(webhook(WEBHOOK, unknown, sign(unknown)).getResponse().getStatus()).isEqualTo(200);
        assertThat(logs()).isEqualTo(before + 3);
        assertThat(webhook(WEBHOOK, "garbage", sign("garbage")).getResponse().getStatus()).isEqualTo(401);
        assertThat(logs()).isEqualTo(before + 4);

        var rows = jdbc.queryForList("SELECT provider, event_type, order_code, is_verified, signature, raw_payload IS NOT NULL AS parsed FROM payment_webhook_logs ORDER BY received_at DESC, id LIMIT 4");
        assertThat(rows).extracting(r -> r.get("provider")).containsOnly("TESTPAY");
        var byReference = jdbc.queryForMap("SELECT event_type, is_verified, signature, raw_body FROM payment_webhook_logs WHERE raw_body=?", valid);
        assertThat(byReference.get("is_verified")).isEqualTo(true);
        assertThat(byReference.get("event_type")).isEqualTo("PAYMENT_SUCCESS");
        assertThat(byReference.get("signature")).isEqualTo(sign(valid));
        var rejected = jdbc.queryForMap("SELECT is_verified, signature FROM payment_webhook_logs WHERE raw_body=?", invalid);
        assertThat(rejected.get("is_verified")).isEqualTo(false);
        assertThat(rejected.get("signature")).isEqualTo("bad");
        assertThat(logCount(reference)).isEqualTo(2);
        assertThat(logCount("NO-SUCH-PAYMENT")).isEqualTo(1);
    }

    @Test
    void theReferenceHintIsStoredOnlyWhenItFitsTheColumn() throws Exception {
        String longReference = "R".repeat(65), fits = "R".repeat(64);
        for (String reference : new String[]{longReference, fits}) {
            String body = webhookBody(reference, "TXN-HINT", "10", "SUCCESS");
            assertThat(webhook(WEBHOOK, body, sign(body)).getResponse().getStatus()).isEqualTo(200);
        }
        assertThat(count("SELECT count(*) FROM payment_webhook_logs WHERE order_code=?", fits)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM payment_webhook_logs WHERE order_code LIKE 'RRRR%' AND length(order_code) > 64")).isZero();
        assertThat(jdbc.queryForObject("SELECT order_code FROM payment_webhook_logs WHERE raw_body LIKE ?", String.class, "%" + longReference + "%")).isNull();
    }

    @Test
    void theWebhookPathIsOpenOnlyForPostAndOnlyForThatPath() throws Exception {
        assertThat(mvc.perform(get(WEBHOOK)).andReturn().getResponse().getStatus()).isEqualTo(401);
        int adminGet = mvc.perform(get(WEBHOOK).header("Authorization", "Bearer " + admin.token())).andReturn().getResponse().getStatus();
        assertThat(adminGet).isEqualTo(405);
        for (String other : new String[]{"/api/v1/webhooks/payments", "/api/v1/webhooks/payments/testpay/extra", "/api/v1/webhooks/other/testpay", "/api/v1/webhooks"}) {
            assertThat(webhook(other, "{}", sign("{}")).getResponse().getStatus()).as(other).isIn(401, 404);
        }
        assertThat(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(WEBHOOK).contentType("application/json").content("{}")).andReturn().getResponse().getStatus()).isEqualTo(401);
        assertThat(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(WEBHOOK)).andReturn().getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void signaturesAndRawBodiesNeverAppearInApplicationLogs(CapturedOutput output) throws Exception {
        var order = payable();
        String reference = referenceOf(order.orderId());
        String marker = "BODY-MARKER-" + UUID.randomUUID();
        String body = "{\"paymentReference\":\"" + reference + "\",\"transactionId\":\"" + marker + "\",\"amount\":" + orderTotal(order.orderId()) + ",\"status\":\"SUCCESS\"}";
        String signature = sign(body);
        webhook(WEBHOOK, body, signature);
        webhook(WEBHOOK, body, "forged-signature-marker");
        webhook(WEBHOOK, "malformed " + marker, sign("malformed " + marker));
        // An anomaly writes a WARN line: still no body, signature or transaction id.
        String mismatch = body.replace("\"SUCCESS\"", "\"SUCCESS\",\"extra\":1").replace(orderTotal(order.orderId()), "1");
        webhook(WEBHOOK, mismatch, sign(mismatch));
        assertThat(output.getAll()).doesNotContain(signature, "forged-signature-marker", marker, com.fruitmachine.backend.support.ControllableGateway.WEBHOOK_SECRET);
        assertThat(output.getAll()).doesNotContain("raw_body", "rawBody");
    }

    @Test
    void aVerifiedEventThatIsNotActionableIsStillAcknowledged() throws Exception {
        long before = count("SELECT count(*) FROM audit_logs");
        for (String body : new String[]{"{\"paymentReference\":\"X\",\"status\":\"PENDING\"}", "{\"status\":\"SUCCESS\"}",
                "{\"paymentReference\":\"X\",\"status\":\"SUCCESS\",\"amount\":1}", "{\"paymentReference\":\"X\",\"status\":\"SUCCESS\",\"transactionId\":\"T\",\"amount\":\"1\"}"}) {
            assertThat(webhook(WEBHOOK, body, sign(body)).getResponse().getStatus()).as(body).isEqualTo(200);
        }
        assertThat(count("SELECT count(*) FROM audit_logs")).isEqualTo(before);
        assertThat(count("SELECT count(*) FROM payments WHERE status IN ('SUCCESS','REFUNDED')")).isZero();
    }
}
