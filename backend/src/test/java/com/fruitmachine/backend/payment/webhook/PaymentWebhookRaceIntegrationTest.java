package com.fruitmachine.backend.payment.webhook;

import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

/** Real PostgreSQL transactions on separate connections: the order lock leaves exactly one winner. */
class PaymentWebhookRaceIntegrationTest extends AbstractWebhookIntegrationTest {
    private PlacedOrder payable() throws Exception {
        var order = placeOrder(2);
        pay(order, 201);
        return order;
    }

    @Test
    void webhookRacingWithTheExpirySweepLeavesExactlyOneConsistentOutcome() throws Exception {
        for (int round = 0; round < 5; round++) {
            var order = payable();
            String reference = referenceOf(order.orderId());
            String body = webhookBody(reference, "TXN-SWEEP-" + round, orderTotal(order.orderId()), "SUCCESS");
            clock.advance(Duration.ofMinutes(6));
            List<Integer> results = parallel(List.of(() -> webhook(WEBHOOK, body, sign(body)).getResponse().getStatus(), () -> expiry.sweep()));
            clock.reset();
            assertThat(results.get(0)).isEqualTo(200);
            // The money arrived in both cases, so the payment is SUCCESS either way.
            assertThat(paymentStatus(reference)).isEqualTo("SUCCESS");
            UUID payment = paymentId(reference);
            long reserved = count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='RESERVED'", order.shop().slotId());
            long released = count("SELECT count(*) FROM inventory_transactions WHERE reference_id=? AND type='RETURN'", order.orderId());
            if (orderStatus(order.orderId()).equals("PAID")) {
                assertThat(reserved).isEqualTo(2);
                assertThat(released).isZero();
                assertThat(auditCount("PAYMENT_LATE", payment)).isZero();
            } else {
                assertThat(orderStatus(order.orderId())).isEqualTo("CANCELLED");
                assertThat(reserved).isZero();
                assertThat(released).isEqualTo(2);
                assertThat(auditCount("PAYMENT_LATE", payment)).isEqualTo(1);
            }
        }
    }

    @Test
    void webhookRacingWithAKioskCancelNeverBothReleasesTheBowlsAndMarksTheOrderPaid() throws Exception {
        for (int round = 0; round < 5; round++) {
            var order = payable();
            String reference = referenceOf(order.orderId());
            String body = webhookBody(reference, "TXN-CANCEL-" + round, orderTotal(order.orderId()), "SUCCESS");
            List<Integer> results = parallel(List.of(() -> webhook(WEBHOOK, body, sign(body)).getResponse().getStatus(),
                    () -> kioskCall("POST", "/api/v1/kiosk/orders/" + order.orderId() + "/cancel", order.shop().key(), null).getResponse().getStatus()));
            assertThat(results.get(0)).isEqualTo(200);
            assertThat(paymentStatus(reference)).isEqualTo("SUCCESS");
            long reserved = count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='RESERVED'", order.shop().slotId());
            if (orderStatus(order.orderId()).equals("PAID")) {
                // The webhook won: the cancel was refused and the bowls are still reserved.
                assertThat(results.get(1)).isEqualTo(409);
                assertThat(reserved).isEqualTo(2);
                assertThat(count("SELECT count(*) FROM inventory_transactions WHERE reference_id=? AND type='RETURN'", order.orderId())).isZero();
            } else {
                // The cancel won: the order stays CANCELLED, the bowls are released and the payment is a recorded late payment.
                assertThat(orderStatus(order.orderId())).isEqualTo("CANCELLED");
                assertThat(results.get(1)).isEqualTo(200);
                assertThat(reserved).isZero();
                assertThat(auditCount("PAYMENT_LATE", paymentId(reference))).isEqualTo(1);
            }
        }
    }

    @Test
    void aWebhookArrivingWhileTheAttemptIsStillBeingCreatedIsNotLost() throws Exception {
        var order = placeOrder(1);
        // The provider call is in flight (step 2, no transaction); the customer pays and the webhook arrives right now.
        gateway.duringCall(() -> {
            try {
                String reference = gateway.requests().get(0).paymentReference();
                String body = webhookBody(reference, "TXN-STEP3", orderTotal(order.orderId()), "SUCCESS");
                assertThat(webhook(WEBHOOK, body, sign(body)).getResponse().getStatus()).isEqualTo(200);
            } catch (Exception ex) {
                throw new IllegalStateException(ex);
            }
        });
        // Step 3 finds the attempt no longer PENDING, so it keeps nothing and answers 409.
        pay(order, 409);
        String reference = referenceOf(order.orderId());
        assertThat(paymentStatus(reference)).isEqualTo("SUCCESS");
        assertThat(jdbc.queryForObject("SELECT transaction_id FROM payments WHERE payment_reference=?", String.class, reference)).isEqualTo("TXN-STEP3");
        assertThat(orderStatus(order.orderId())).isEqualTo("PAID");
        // No lost update, and a paid link is never cancelled at the provider.
        assertThat(gateway.cancels()).isEmpty();
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=?", order.orderId())).isEqualTo(1);
    }

    @Test
    void manyDifferentWebhooksForManyOrdersAllApplyIndependently() throws Exception {
        var shop = shop(20);
        var orders = new java.util.ArrayList<PlacedOrder>();
        for (int i = 0; i < 6; i++) {
            var order = placeOrder(shop, 1);
            pay(order, 201);
            orders.add(order);
        }
        List<Callable<Integer>> tasks = new java.util.ArrayList<>();
        for (int i = 0; i < orders.size(); i++) {
            var order = orders.get(i);
            String body = webhookBody(referenceOf(order.orderId()), "TXN-MANY-" + i, orderTotal(order.orderId()), "SUCCESS");
            tasks.add(() -> webhook(WEBHOOK, body, sign(body)).getResponse().getStatus());
        }
        assertThat(parallel(tasks)).containsOnly(200);
        assertThat(count("SELECT count(*) FROM orders WHERE machine_id=? AND status='PAID'", shop.machineId())).isEqualTo(6);
        assertThat(count("SELECT count(*) FROM audit_logs a JOIN payments p ON p.id=a.entity_id JOIN orders o ON o.id=p.order_id WHERE o.machine_id=?", shop.machineId())).isZero();
    }
}
