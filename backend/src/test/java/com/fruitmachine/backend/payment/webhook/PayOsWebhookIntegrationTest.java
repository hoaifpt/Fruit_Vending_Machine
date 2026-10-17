package com.fruitmachine.backend.payment.webhook;

import com.fruitmachine.backend.support.AbstractOrderIntegrationTest;
import com.fruitmachine.backend.support.StubPayOsServer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** PAYMENT_PROVIDER=PAYOS: payOS-signed webhooks (fixtures signed here with the test checksum key) through the real endpoint. */
class PayOsWebhookIntegrationTest extends AbstractOrderIntegrationTest {
    static final StubPayOsServer STUB = new StubPayOsServer();
    static final String CHECKSUM = "webhook-it-checksum-key";
    static final String WEBHOOK = "/api/v1/webhooks/payments/payos";

    @DynamicPropertySource
    static void payos(DynamicPropertyRegistry registry) {
        registry.add("app.payment.provider", () -> "PAYOS");
        registry.add("app.payment.attempt-ttl", () -> "PT2M");
        registry.add("app.payment.payos.base-url", STUB::baseUrl);
        registry.add("app.payment.payos.client-id", () -> "webhook-it-client");
        registry.add("app.payment.payos.api-key", () -> "webhook-it-api-key");
        registry.add("app.payment.payos.checksum-key", () -> CHECKSUM);
        registry.add("app.payment.payos.return-url", () -> "https://shop.example.invalid/return");
        registry.add("app.payment.payos.cancel-url", () -> "https://shop.example.invalid/cancel");
        registry.add("app.payment.payos.cancel-timeout", () -> "PT1S");
    }

    @AfterAll
    static void stopStub() {
        STUB.close();
    }

    @BeforeEach
    void resetStub() {
        STUB.reset();
    }

    record Placed(UUID machineId, UUID slotId, String key, UUID orderId, String reference, String total) {}

    private Placed place(String price, int quantity) throws Exception {
        UUID machine = fixtures.machine(admin.token());
        UUID slot = createSlot(machine, "W1", 10), product = createProduct("Webhook bowl", price);
        load(fixtures.batch(product, quantity + 1, staff.token()), slot, quantity + 1);
        String key = issueKey(machine);
        UUID orderId = UUID.fromString(kioskData("POST", "/api/v1/kiosk/orders", key, orderBody(line(product, quantity)), 201).path("id").asText());
        kioskJson("POST", "/api/v1/kiosk/orders/" + orderId + "/payments", key, null, 201);
        String reference = jdbc.queryForObject("SELECT payment_reference FROM payments WHERE order_id=? ORDER BY created_at DESC LIMIT 1", String.class, orderId);
        String total = jdbc.queryForObject("SELECT total_amount::bigint::text FROM orders WHERE id=?", String.class, orderId);
        return new Placed(machine, slot, key, orderId, reference, total);
    }

    /** A payOS webhook whose signature is built independently: sorted key=value pairs joined by &, HMAC-SHA256 under the key. */
    private String payosBody(String key, long orderCode, String amount, String reference, String code) throws Exception {
        Map<String, Object> data = new TreeMap<>();
        data.put("orderCode", orderCode);
        data.put("amount", Long.parseLong(amount));
        data.put("description", "FV7K3QF9X");
        data.put("accountNumber", "12345678");
        data.put("reference", reference);
        data.put("transactionDateTime", "2026-10-16 11:02:13");
        data.put("currency", "VND");
        data.put("paymentLinkId", "fake-link-id");
        data.put("code", code);
        data.put("desc", "success");
        for (String blank : List.of("counterAccountBankId", "counterAccountBankName", "counterAccountName", "counterAccountNumber", "virtualAccountName", "virtualAccountNumber")) data.put(blank, "");
        String canonical = data.entrySet().stream().map(e -> e.getKey() + "=" + e.getValue()).collect(Collectors.joining("&"));
        // Serialized in reverse key order: the signature must not depend on the order the provider happens to send.
        var reversed = new LinkedHashMap<String, Object>();
        var keys = new ArrayList<>(data.keySet());
        Collections.reverse(keys);
        keys.forEach(k -> reversed.put(k, data.get(k)));
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("code", code);
        root.put("desc", "success");
        root.put("success", code.equals("00"));
        root.put("data", reversed);
        root.put("signature", com.fruitmachine.backend.support.IndependentHmac.hex(key, canonical));
        return json.writeValueAsString(root);
    }

    private int deliver(String body) throws Exception {
        return mvc.perform(post(WEBHOOK).contentType("application/json").content(body)).andReturn().getResponse().getStatus();
    }

    @Test
    void aPayosSignedSuccessWebhookMarksThePaymentSuccessAndTheOrderPaid() throws Exception {
        var order = place("35000", 2);
        String body = payosBody(CHECKSUM, Long.parseLong(order.reference()), order.total(), "FT26101600001", "00");
        var response = mvc.perform(post(WEBHOOK).contentType("application/json").content(body)).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentAsString()).isEqualTo("{\"success\":true}");

        var payment = jdbc.queryForMap("SELECT status, transaction_id, provider FROM payments WHERE payment_reference=?", order.reference());
        assertThat(payment.get("status")).isEqualTo("SUCCESS");
        assertThat(payment.get("transaction_id")).isEqualTo("FT26101600001");
        assertThat(payment.get("provider")).isEqualTo("PAYOS");
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, order.orderId())).isEqualTo("PAID");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='RESERVED'", Long.class, order.slotId())).isEqualTo(2);
        var row = jdbc.queryForMap("SELECT provider, event_type, order_code, is_verified, signature FROM payment_webhook_logs WHERE order_code=?", order.reference());
        assertThat(row.get("provider")).isEqualTo("PAYOS");
        assertThat(row.get("event_type")).isEqualTo("PAYMENT_SUCCESS");
        assertThat(row.get("is_verified")).isEqualTo(true);
        assertThat((String) row.get("signature")).matches("[0-9a-f]{64}");
        // Re-delivery is a no-op.
        assertThat(deliver(body)).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM payments WHERE order_id=? AND status='SUCCESS'", Long.class, order.orderId())).isEqualTo(1);
    }

    @Test
    void aTamperedOrWronglySignedPayosWebhookIsRejected() throws Exception {
        var order = place("35000", 1);
        long code = Long.parseLong(order.reference());
        String good = payosBody(CHECKSUM, code, order.total(), "FT-A", "00");
        assertThat(deliver(good.replace("\"amount\":" + order.total(), "\"amount\":1"))).isEqualTo(401);
        assertThat(deliver(good.replace("\"reference\":\"FT-A\"", "\"reference\":\"FT-B\""))).isEqualTo(401);
        assertThat(deliver(payosBody("some-other-key", code, order.total(), "FT-A", "00"))).isEqualTo(401);
        assertThat(deliver(good.replace("\"signature\":\"", "\"signature\":\"0"))).isEqualTo(401);
        assertThat(deliver("{\"code\":\"00\",\"data\":{\"orderCode\":" + code + "}}")).isEqualTo(401);
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE payment_reference=?", String.class, order.reference())).isEqualTo("PENDING");
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, order.orderId())).isEqualTo("PENDING_PAYMENT");
        // The rejected attempts are evidence, with the unverified orderCode hint.
        assertThat(jdbc.queryForObject("SELECT count(*) FROM payment_webhook_logs WHERE order_code=? AND NOT is_verified", Long.class, order.reference())).isGreaterThanOrEqualTo(4);
    }

    @Test
    void thePayosRegistrationProbeWithAnUnknownOrderCodeIsAcknowledgedWith200() throws Exception {
        long audits = jdbc.queryForObject("SELECT count(*) FROM audit_logs", Long.class);
        String probe = payosBody(CHECKSUM, 123, "3000", "TF230204212323", "00");
        assertThat(deliver(probe)).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_logs", Long.class)).isEqualTo(audits);
        var row = jdbc.queryForMap("SELECT is_verified, order_code FROM payment_webhook_logs WHERE order_code='123' ORDER BY received_at DESC LIMIT 1");
        assertThat(row.get("is_verified")).isEqualTo(true);
    }

    @Test
    void aNonSuccessCodeBecomesAFailedPaymentAndAnAmountMismatchIsAnAnomaly() throws Exception {
        var failing = place("35000", 1);
        assertThat(deliver(payosBody(CHECKSUM, Long.parseLong(failing.reference()), failing.total(), "FT-FAIL", "01"))).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE payment_reference=?", String.class, failing.reference())).isEqualTo("FAILED");
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, failing.orderId())).isEqualTo("PENDING_PAYMENT");

        var mismatch = place("35000", 1);
        assertThat(deliver(payosBody(CHECKSUM, Long.parseLong(mismatch.reference()), "34999", "FT-MISMATCH", "00"))).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE payment_reference=?", String.class, mismatch.reference())).isEqualTo("PENDING");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_logs a JOIN payments p ON p.id=a.entity_id WHERE p.payment_reference=? AND a.action='PAYMENT_AMOUNT_MISMATCH'", Long.class, mismatch.reference())).isEqualTo(1);
    }

    @Test
    void thePathMustNameTheActiveProviderAndPayingCancelsOtherLinksAfterCommit() throws Exception {
        assertThat(mvc.perform(post("/api/v1/webhooks/payments/mock").contentType("application/json").content("{}")).andReturn().getResponse().getStatus()).isEqualTo(404);
        assertThat(mvc.perform(post("/api/v1/webhooks/payments/PayOS").contentType("application/json").content(payosBody(CHECKSUM, 5, "1000", "R", "00")))
                .andReturn().getResponse().getStatus()).isEqualTo(200);

        var order = place("35000", 1);
        jdbc.update("INSERT INTO payments(order_id, provider, payment_reference, amount, status, qr_code, expired_at) VALUES (?, 'PAYOS', '261016000000999', ?::numeric, 'PENDING', 'QR', now() + interval '1 minute')",
                order.orderId(), order.total());
        STUB.reset();
        assertThat(deliver(payosBody(CHECKSUM, Long.parseLong(order.reference()), order.total(), "FT-PAYING", "00"))).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE payment_reference='261016000000999'", String.class)).isEqualTo("EXPIRED");
        // The superseded link is invalidated at payOS only after the commit; the paying link is left alone.
        assertThat(STUB.cancels()).hasSize(1);
        assertThat(STUB.cancels().get(0).path()).isEqualTo("/v2/payment-requests/261016000000999/cancel");
        assertThat(json.readTree(STUB.cancels().get(0).body()).get("cancellationReason").asText()).isEqualTo("ORDER_PAID");
    }
}
