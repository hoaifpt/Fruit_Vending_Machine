package com.fruitmachine.backend.payment;

import com.fruitmachine.backend.support.AbstractPaymentIntegrationTest;
import com.fruitmachine.backend.support.ControllableGateway.Mode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class PaymentLifecycleIntegrationTest extends AbstractPaymentIntegrationTest {
    @Test
    void kioskCancelExpiresPendingAttemptsAndReleasesInventory() throws Exception {
        var order = placeOrder(2);
        var shop = order.shop();
        pay(order, 201);
        kioskJson("POST", "/api/v1/kiosk/orders/" + order.orderId() + "/cancel", shop.key(), null, 200);
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE order_id=?", String.class, order.orderId())).isEqualTo("EXPIRED");
        assertThat(orderStatus(order.orderId())).isEqualTo("CANCELLED");
        assertThat(count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='RESERVED'", shop.slotId())).isZero();
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE reference_id=? AND type='RETURN'", order.orderId())).isEqualTo(2);
        // Cancelling again stays idempotent and keeps the payment EXPIRED.
        kioskJson("POST", "/api/v1/kiosk/orders/" + order.orderId() + "/cancel", shop.key(), null, 200);
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=? AND status='EXPIRED'", order.orderId())).isEqualTo(1);
    }

    @Test
    void expirySweepExpiresPendingAttemptsAndReleasesInventory() throws Exception {
        var order = placeOrder(1);
        pay(order, 201);
        clock.advance(Duration.ofMinutes(6));
        assertThat(expiry.sweep()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE order_id=?", String.class, order.orderId())).isEqualTo("EXPIRED");
        assertThat(orderStatus(order.orderId())).isEqualTo("CANCELLED");
        assertThat(count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='AVAILABLE'", order.shop().slotId())).isEqualTo(3);
    }

    @Test
    void failedAndExpiredAttemptsNeverChangeTheOrderAndNothingProducesSuccessOrPaid() throws Exception {
        var order = placeOrder(1);
        gateway.mode(Mode.FAIL);
        pay(order, 502);
        gateway.mode(Mode.SUCCESS);
        pay(order, 201);
        clock.advance(Duration.ofMinutes(2).plusSeconds(1));
        pay(order, 201);
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=? AND status='FAILED'", order.orderId())).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=? AND status='EXPIRED'", order.orderId())).isEqualTo(1);
        assertThat(orderStatus(order.orderId())).isEqualTo("PENDING_PAYMENT");
        assertThat(count("SELECT count(*) FROM payments WHERE status IN ('SUCCESS','REFUNDED') OR paid_at IS NOT NULL OR transaction_id IS NOT NULL")).isZero();
        assertThat(count("SELECT count(*) FROM orders WHERE status='PAID' OR paid_at IS NOT NULL")).isZero();
    }

    @Test
    void kioskPollingShowsTheLatestAttemptAndHidesAStaleQr() throws Exception {
        var order = placeOrder(1);
        assertThat(kioskData("GET", order.order(), order.shop().key(), null, 200).path("currentPayment").isNull()).isTrue();
        var created = pay(order, 201).path("data");
        var polled = kioskData("GET", order.order(), order.shop().key(), null, 200);
        assertThat(polled.path("currentPayment")).isEqualTo(created);
        assertThat(polled.path("status").asText()).isEqualTo("PENDING_PAYMENT");
        // A newer attempt wins; an old one that is no longer payable never shows its QR.
        clock.advance(Duration.ofMinutes(2).plusSeconds(1));
        gateway.mode(Mode.FAIL);
        pay(order, 502);
        var failed = kioskData("GET", order.order(), order.shop().key(), null, 200).path("currentPayment");
        assertThat(failed.path("status").asText()).isEqualTo("FAILED");
        assertThat(failed.path("qrCode").isNull()).isTrue();
        assertThat(failed.path("paymentId")).isNotEqualTo(created.path("paymentId"));
        // Reads never write: polling an overdue attempt does not change it.
        clock.advance(Duration.ofSeconds(30));
        var before = count("SELECT count(*) FROM payments WHERE order_id=? AND status='PENDING'", order.orderId());
        kioskData("GET", order.order(), order.shop().key(), null, 200);
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=? AND status='PENDING'", order.orderId())).isEqualTo(before);
        // Another machine cannot read the order.
        kioskJson("GET", order.order(), shop(1).key(), null, 404);
    }

    @Test
    void cancelledOrderPollsAnExpiredPaymentWithoutQr() throws Exception {
        var order = placeOrder(1);
        pay(order, 201);
        var cancelled = kioskData("POST", "/api/v1/kiosk/orders/" + order.orderId() + "/cancel", order.shop().key(), null, 200);
        assertThat(cancelled.path("currentPayment").path("status").asText()).isEqualTo("EXPIRED");
        assertThat(cancelled.path("currentPayment").path("qrCode").isNull()).isTrue();
    }

    @Test
    void concurrentCreateRequestsProduceAtMostOneAttempt() throws Exception {
        var order = placeOrder(1);
        // Keep the first provider call open so the second request overlaps with it.
        gateway.duringCall(() -> sleep(400));
        List<Integer> statuses = parallel(List.of(
                () -> kioskCall("POST", order.payments(), order.shop().key(), null).getResponse().getStatus(),
                () -> kioskCall("POST", order.payments(), order.shop().key(), null).getResponse().getStatus(),
                () -> kioskCall("POST", order.payments(), order.shop().key(), null).getResponse().getStatus()));
        assertThat(statuses.stream().filter(s -> s == 201).count()).isEqualTo(1);
        assertThat(statuses).allMatch(s -> s == 201 || s == 200 || s == 409);
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=?", order.orderId())).isEqualTo(1);
        assertThat(gateway.calls()).isEqualTo(1);
    }

    @Test
    void createAttemptRacingWithCancelNeverLeavesAPendingAttemptOnACancelledOrder() throws Exception {
        for (int round = 0; round < 4; round++) {
            var order = placeOrder(1);
            gateway.reset();
            gateway.duringCall(() -> sleep(150));
            List<Integer> statuses = parallel(List.of(
                    () -> kioskCall("POST", order.payments(), order.shop().key(), null).getResponse().getStatus(),
                    () -> kioskCall("POST", "/api/v1/kiosk/orders/" + order.orderId() + "/cancel", order.shop().key(), null).getResponse().getStatus()));
            assertThat(statuses.get(1)).isEqualTo(200);
            assertThat(statuses.get(0)).isIn(201, 409);
            assertThat(orderStatus(order.orderId())).isEqualTo("CANCELLED");
            assertThat(count("SELECT count(*) FROM payments WHERE order_id=? AND status='PENDING'", order.orderId())).isZero();
            assertThat(count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='RESERVED'", order.shop().slotId())).isZero();
        }
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }
    }

    private List<Integer> parallel(List<Callable<Integer>> tasks) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(tasks.size());
        try {
            CountDownLatch ready = new CountDownLatch(tasks.size()), go = new CountDownLatch(1);
            List<Future<Integer>> futures = new ArrayList<>();
            for (Callable<Integer> task : tasks) futures.add(pool.submit(() -> { ready.countDown(); go.await(); return task.call(); }));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            go.countDown();
            List<Integer> results = new ArrayList<>();
            for (Future<Integer> future : futures) results.add(future.get(60, TimeUnit.SECONDS));
            return results;
        } finally {
            pool.shutdownNow();
        }
    }
}
