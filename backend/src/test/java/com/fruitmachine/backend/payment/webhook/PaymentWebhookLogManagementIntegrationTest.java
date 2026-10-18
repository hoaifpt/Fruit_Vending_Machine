package com.fruitmachine.backend.payment.webhook;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class PaymentWebhookLogManagementIntegrationTest extends AbstractWebhookIntegrationTest {
    private static final String LOGS = "/api/v1/payment-webhook-logs";

    @Test
    void adminListsFiltersPagesAndSortsWebhookAttempts() throws Exception {
        Instant start = Instant.now().minusSeconds(5);
        String unique = "LOG-REF-" + UUID.randomUUID().toString().substring(0, 8);
        String good = webhookBody(unique, "TXN-L1", "10", "SUCCESS");
        send(good);
        String forged = webhookBody(unique, "TXN-L2", "10", "SUCCESS");
        webhook(WEBHOOK, forged, "forged");
        webhook(WEBHOOK, "not json", sign("not json"));

        var page = fixtures.api("GET", LOGS + "?reference=" + unique + "&size=1&page=0", null, admin.token(), 200);
        assertThat(page.path("totalElements").asInt()).isEqualTo(2);
        assertThat(page.path("totalPages").asInt()).isEqualTo(2);
        var item = page.path("content").get(0);
        assertThat(item.fieldNames()).toIterable().containsExactlyInAnyOrder("id", "provider", "eventType", "reference", "verified", "receivedAt");
        assertThat(item.path("provider").asText()).isEqualTo("TESTPAY");
        assertThat(item.path("reference").asText()).isEqualTo(unique);
        // Newest first by default: the forged attempt was received after the valid one.
        assertThat(item.path("verified").asBoolean()).isFalse();
        var oldest = fixtures.api("GET", LOGS + "?reference=" + unique + "&sort=receivedAt,asc&size=5", null, admin.token(), 200);
        assertThat(oldest.path("content").get(0).path("verified").asBoolean()).isTrue();
        assertThat(oldest.path("content").get(0).path("eventType").asText()).isEqualTo("PAYMENT_SUCCESS");

        assertThat(fixtures.api("GET", LOGS + "?reference=" + unique + "&verified=true", null, admin.token(), 200).path("totalElements").asInt()).isEqualTo(1);
        assertThat(fixtures.api("GET", LOGS + "?reference=" + unique + "&verified=false", null, admin.token(), 200).path("totalElements").asInt()).isEqualTo(1);
        assertThat(fixtures.api("GET", LOGS + "?reference=" + unique + "&provider=testpay", null, admin.token(), 200).path("totalElements").asInt()).isEqualTo(2);
        assertThat(fixtures.api("GET", LOGS + "?reference=" + unique + "&provider=payos", null, admin.token(), 200).path("totalElements").asInt()).isZero();
        assertThat(fixtures.api("GET", LOGS + "?reference=" + unique + "x", null, admin.token(), 200).path("totalElements").asInt()).isZero();
        assertThat(fixtures.api("GET", LOGS + "?receivedFrom=" + start + "&receivedTo=" + Instant.now().plusSeconds(60) + "&size=100", null, admin.token(), 200)
                .path("totalElements").asInt()).isGreaterThanOrEqualTo(3);
        assertThat(fixtures.api("GET", LOGS + "?reference=" + unique + "&receivedTo=" + start, null, admin.token(), 200).path("totalElements").asInt()).isZero();
        assertThat(fixtures.api("GET", LOGS + "?sort=provider,asc&size=3", null, admin.token(), 200).path("content")).isNotEmpty();
        for (String bad : new String[]{"size=0", "size=101", "page=-1", "sort=signature,asc", "sort=receivedAt,sideways", "verified=maybe", "receivedFrom=yesterday"})
            fixtures.response("GET", LOGS + "?" + bad, null, admin.token(), 400);
    }

    @Test
    void detailsShowTheEvidenceButNeverTheSignature() throws Exception {
        String unique = "DETAIL-REF-" + UUID.randomUUID().toString().substring(0, 8);
        String body = webhookBody(unique, "TXN-D1", "10", "SUCCESS");
        String signature = sign(body);
        send(body);
        webhook(WEBHOOK, "plain text, not json " + unique, sign("x"));
        var list = fixtures.api("GET", LOGS + "?reference=" + unique, null, admin.token(), 200);
        UUID jsonId = UUID.fromString(list.path("content").get(0).path("id").asText());

        JsonNode detail = fixtures.api("GET", LOGS + "/" + jsonId, null, admin.token(), 200);
        assertThat(detail.path("rawPayload").path("paymentReference").asText()).isEqualTo(unique);
        assertThat(detail.path("rawBody").isNull()).isTrue();
        assertThat(detail.path("verified").asBoolean()).isTrue();
        assertThat(detail.fieldNames()).toIterable().doesNotContain("signature");
        assertThat(detail.toString()).doesNotContain(signature);

        UUID textId = jdbc.queryForObject("SELECT id FROM payment_webhook_logs WHERE raw_body LIKE ?", UUID.class, "plain text, not json " + unique);
        JsonNode text = fixtures.api("GET", LOGS + "/" + textId, null, admin.token(), 200);
        assertThat(text.path("rawPayload").isNull()).isTrue();
        assertThat(text.path("rawBody").asText()).isEqualTo("plain text, not json " + unique);
        assertThat(text.path("verified").asBoolean()).isFalse();
        assertThat(text.toString()).doesNotContain(sign("x"));

        fixtures.response("GET", LOGS + "/" + UUID.randomUUID(), null, admin.token(), 404);
        fixtures.response("GET", LOGS + "/not-a-uuid", null, admin.token(), 400);
    }

    @Test
    void onlyAdminMayReadAndNoWriteReplayOrDeleteOperationExists() throws Exception {
        String body = webhookBody("ACCESS-REF", "T", "1", "SUCCESS");
        send(body);
        UUID id = jdbc.queryForObject("SELECT id FROM payment_webhook_logs WHERE order_code='ACCESS-REF' LIMIT 1", UUID.class);
        var order = placeOrder();
        for (String path : new String[]{LOGS, LOGS + "/" + id}) {
            fixtures.response("GET", path, null, staff.token(), 403);
            fixtures.response("GET", path, null, null, 401);
            assertThat(kioskCall("GET", path, order.shop().key(), null).getResponse().getStatus()).isEqualTo(401);
        }
        for (String method : new String[]{"POST", "PUT", "PATCH", "DELETE"}) {
            for (String path : new String[]{LOGS, LOGS + "/" + id, LOGS + "/" + id + "/replay"}) {
                int adminStatus = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .request(org.springframework.http.HttpMethod.valueOf(method), path).header("Authorization", "Bearer " + admin.token())
                        .contentType("application/json").content("{}")).andReturn().getResponse().getStatus();
                assertThat(adminStatus).as("%s %s", method, path).isIn(404, 405);
                fixtures.response(method, path, java.util.Map.of(), staff.token(), 403);
            }
        }
        assertThat(count("SELECT count(*) FROM payment_webhook_logs WHERE id=?", id)).isEqualTo(1);
        // Payments cannot be marked paid through any management path either.
        for (String path : new String[]{"/api/v1/payments/" + UUID.randomUUID() + "/mark-paid", "/api/v1/payments/" + UUID.randomUUID() + "/success"}) {
            int status = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(path)
                    .header("Authorization", "Bearer " + admin.token()).contentType("application/json").content("{}")).andReturn().getResponse().getStatus();
            assertThat(status).isIn(404, 405);
        }
    }

    @Test
    void anAnomalousPaymentIsReachableFromTheWebhookLogByItsReference() throws Exception {
        var order = placeOrder();
        pay(order, 201);
        String reference = referenceOf(order.orderId());
        paid(reference, "TXN-MISMATCH", "1");
        var logs = fixtures.api("GET", LOGS + "?reference=" + reference, null, admin.token(), 200);
        assertThat(logs.path("totalElements").asInt()).isEqualTo(1);
        var detail = fixtures.api("GET", LOGS + "/" + logs.path("content").get(0).path("id").asText(), null, admin.token(), 200);
        assertThat(detail.path("rawPayload").path("amount").decimalValue()).isEqualByComparingTo("1");
        assertThat(auditCount("PAYMENT_AMOUNT_MISMATCH", paymentId(reference))).isEqualTo(1);
    }
}
