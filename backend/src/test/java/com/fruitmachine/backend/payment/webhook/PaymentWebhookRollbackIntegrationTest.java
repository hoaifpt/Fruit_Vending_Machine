package com.fruitmachine.backend.payment.webhook;

import com.fruitmachine.backend.payment.service.PaymentConfirmationService;
import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;

class PaymentWebhookRollbackIntegrationTest extends AbstractWebhookIntegrationTest {
    @MockitoSpyBean PaymentConfirmationService confirmation;

    @Test
    void theLogRowSurvivesWhenBusinessProcessingFailsAndTheProviderIsToldToRetry() throws Exception {
        var order = placeOrder(1);
        pay(order, 201);
        String reference = referenceOf(order.orderId());
        String body = webhookBody(reference, "TXN-ROLLBACK", orderTotal(order.orderId()), "SUCCESS");
        long before = count("SELECT count(*) FROM payment_webhook_logs");
        doThrow(new IllegalStateException("simulated database outage")).when(confirmation).process(any(), any());

        var response = webhook(WEBHOOK, body, sign(body)).getResponse();
        // Unexpected internal errors answer 500 with no internals, so the provider retries.
        assertThat(response.getStatus()).isEqualTo(500);
        assertThat(response.getContentAsString()).doesNotContain("simulated database outage", "TXN-ROLLBACK");
        assertThat(count("SELECT count(*) FROM payment_webhook_logs")).isEqualTo(before + 1);
        var row = jdbc.queryForMap("SELECT is_verified, raw_body FROM payment_webhook_logs WHERE raw_body=?", body);
        assertThat(row.get("is_verified")).isEqualTo(true);
        assertThat(paymentStatus(reference)).isEqualTo("PENDING");
        assertThat(orderStatus(order.orderId())).isEqualTo("PENDING_PAYMENT");
    }
}
