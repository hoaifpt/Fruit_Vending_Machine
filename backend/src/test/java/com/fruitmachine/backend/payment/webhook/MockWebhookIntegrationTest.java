package com.fruitmachine.backend.payment.webhook;

import com.fruitmachine.backend.payment.gateway.HmacSha256;
import com.fruitmachine.backend.support.AbstractOrderIntegrationTest;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** The real MOCK gateway (the default provider) with a configured webhook secret, end to end. */
class MockWebhookIntegrationTest extends AbstractOrderIntegrationTest {
    static final String SECRET = "it-mock-webhook-secret";

    @DynamicPropertySource
    static void mock(DynamicPropertyRegistry registry) {
        registry.add("app.payment.mock.webhook-secret", () -> SECRET);
    }

    @Test
    void aSignedMockWebhookMarksTheMockPaymentSuccessfulAndTheOrderPaid() throws Exception {
        UUID machine = fixtures.machine(admin.token());
        UUID slot = createSlot(machine, "M1", 10), product = createProduct("Mock bowl", "35000");
        load(fixtures.batch(product, 3, staff.token()), slot, 3);
        String key = issueKey(machine);
        UUID orderId = UUID.fromString(kioskData("POST", "/api/v1/kiosk/orders", key, orderBody(line(product, 2)), 201).path("id").asText());
        var payment = kioskData("POST", "/api/v1/kiosk/orders/" + orderId + "/payments", key, null, 201);
        assertThat(payment.path("provider").asText()).isEqualTo("MOCK");
        String reference = jdbc.queryForObject("SELECT payment_reference FROM payments WHERE order_id=?", String.class, orderId);

        String body = "{\"paymentReference\":\"" + reference + "\",\"transactionId\":\"MOCK-TXN-0001\",\"amount\":70000.00,\"status\":\"SUCCESS\"}";
        var response = mvc.perform(post("/api/v1/webhooks/payments/mock").contentType("application/json").content(body)
                .header("X-Mock-Signature", HmacSha256.hex(SECRET, body))).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, orderId)).isEqualTo("PAID");
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE payment_reference=?", String.class, reference)).isEqualTo("SUCCESS");
        var polled = kioskData("GET", "/api/v1/kiosk/orders/" + orderId, key, null, 200);
        assertThat(polled.path("status").asText()).isEqualTo("PAID");
        assertThat(polled.path("currentPayment").path("status").asText()).isEqualTo("SUCCESS");

        // The same body with the wrong secret, and the payOS path while MOCK is active, change nothing.
        String again = body.replace("MOCK-TXN-0001", "MOCK-TXN-0002");
        assertThat(mvc.perform(post("/api/v1/webhooks/payments/mock").contentType("application/json").content(again)
                .header("X-Mock-Signature", HmacSha256.hex("wrong", again))).andReturn().getResponse().getStatus()).isEqualTo(401);
        assertThat(mvc.perform(post("/api/v1/webhooks/payments/payos").contentType("application/json").content(again)).andReturn().getResponse().getStatus()).isEqualTo(404);
        assertThat(jdbc.queryForObject("SELECT transaction_id FROM payments WHERE payment_reference=?", String.class, reference)).isEqualTo("MOCK-TXN-0001");
    }
}
