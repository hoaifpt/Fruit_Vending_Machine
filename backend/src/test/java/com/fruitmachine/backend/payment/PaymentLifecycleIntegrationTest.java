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
    @org.springframework.beans.factory.annotation.Autowired com.fruitmachine.backend.payment.service.PaymentService paymentService;
    @org.springframework.beans.factory.annotation.Autowired com.fruitmachine.backend.order.repository.OrderRepository orders;
    @org.springframework.beans.factory.annotation.Autowired org.springframework.transaction.support.TransactionTemplate transactions;

    @Test
    void kioskCancelExpiresPendingAttemptsAndReleasesInventory() throws Exception {
        var order = placeOrder();
        var shop = order.shop();
        pay(order, 201);
        kioskJson("POST", "/api/v1/kiosk/orders/" + order.orderId() + "/cancel", shop.key(), null, 200);
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE order_id=?", String.class, order.orderId())).isEqualTo("EXPIRED");
        assertThat(orderStatus(order.orderId())).isEqualTo("CANCELLED");
        assertThat(count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='RESERVED'", shop.slotId())).isZero();
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE reference_id=? AND type='RETURN'", order.orderId())).isEqualTo(1);
        // Cancelling again stays idempotent and keeps the payment EXPIRED.
        kioskJson("POST", "/api/v1/kiosk/orders/" + order.orderId() + "/cancel", shop.key(), null, 200);
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=? AND status='EXPIRED'", order.orderId())).isEqualTo(1);
    }

    @Test
    void expirySweepExpiresPendingAttemptsAndReleasesInventory() throws Exception {
        var order = placeOrder();
        pay(order, 201);
        clock.advance(Duration.ofMinutes(6));
        assertThat(expiry.sweep()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE order_id=?", String.class, order.orderId())).isEqualTo("EXPIRED");
        assertThat(orderStatus(order.orderId())).isEqualTo("CANCELLED");
        assertThat(count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='AVAILABLE'", order.shop().slotId())).isEqualTo(3);
    }

    @Test
    void failedAndExpiredAttemptsNeverChangeTheOrderAndNothingProducesSuccessOrPaid() throws Exception {
        var order = placeOrder();
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
        var order = placeOrder();
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
        var order = placeOrder();
        pay(order, 201);
        var cancelled = kioskData("POST", "/api/v1/kiosk/orders/" + order.orderId() + "/cancel", order.shop().key(), null, 200);
        assertThat(cancelled.path("currentPayment").path("status").asText()).isEqualTo("EXPIRED");
        assertThat(cancelled.path("currentPayment").path("qrCode").isNull()).isTrue();
    }

    @Test
    void cancelledAttemptsInvalidateTheProviderLinkOnlyAfterCommitWithTheMatchingReason() throws Exception {
        var cancelled = placeOrder();
        pay(cancelled, 201);
        String cancelledRef = jdbc.queryForObject("SELECT payment_reference FROM payments WHERE order_id=?", String.class, cancelled.orderId());
        assertThat(gateway.cancels()).isEmpty();
        kioskJson("POST", "/api/v1/kiosk/orders/" + cancelled.orderId() + "/cancel", cancelled.shop().key(), null, 200);
        assertThat(gateway.cancels()).hasSize(1);
        assertThat(gateway.cancels().get(0)).containsExactly(cancelledRef, "ORDER_CANCELLED");
        // Idempotent cancel does not call the provider again.
        kioskJson("POST", "/api/v1/kiosk/orders/" + cancelled.orderId() + "/cancel", cancelled.shop().key(), null, 200);
        assertThat(gateway.cancels()).hasSize(1);

        gateway.reset();
        var swept = placeOrder();
        pay(swept, 201);
        String sweptRef = jdbc.queryForObject("SELECT payment_reference FROM payments WHERE order_id=?", String.class, swept.orderId());
        clock.advance(Duration.ofMinutes(6));
        assertThat(expiry.sweep()).isGreaterThanOrEqualTo(1);
        assertThat(gateway.cancels()).anySatisfy(c -> assertThat(c).containsExactly(sweptRef, "RESERVATION_EXPIRED"));
    }

    @Test
    void replacingAnExpiredAttemptInvalidatesTheOldLinkWithAttemptExpired() throws Exception {
        var order = placeOrder();
        pay(order, 201);
        String first = jdbc.queryForObject("SELECT payment_reference FROM payments WHERE order_id=?", String.class, order.orderId());
        clock.advance(Duration.ofMinutes(2).plusSeconds(1));
        pay(order, 201);
        assertThat(gateway.cancels()).hasSize(1);
        assertThat(gateway.cancels().get(0)).containsExactly(first, "ATTEMPT_EXPIRED");
    }

    @Test
    void aRolledBackExpiryDoesNotInvalidateAnything() throws Exception {
        var order = placeOrder();
        pay(order, 201);
        transactions.executeWithoutResult(status -> {
            var entity = orders.findForUpdateById(order.orderId()).orElseThrow();
            paymentService.expirePendingPayments(entity, "ORDER_CANCELLED");
            status.setRollbackOnly();
        });
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE order_id=?", String.class, order.orderId())).isEqualTo("PENDING");
        assertThat(gateway.cancels()).isEmpty();
    }

    @Test
    void attemptsOfAnotherProviderAreNeverCancelledThroughTheActiveGateway() throws Exception {
        var order = placeOrder();
        jdbc.update("INSERT INTO payments(order_id, provider, payment_reference, amount, status, expired_at) VALUES (?, 'MOCK', 'MOCK-OLD', 1, 'PENDING', now() + interval '1 minute')", order.orderId());
        kioskJson("POST", "/api/v1/kiosk/orders/" + order.orderId() + "/cancel", order.shop().key(), null, 200);
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE payment_reference='MOCK-OLD'", String.class)).isEqualTo("EXPIRED");
        assertThat(gateway.cancels()).isEmpty();
    }

    @Test
    void aLinkCreatedWhileTheOrderWasCancelledIsInvalidatedToo() throws Exception {
        var order = placeOrder();
        gateway.duringCall(() -> {
            try {
                kioskJson("POST", "/api/v1/kiosk/orders/" + order.orderId() + "/cancel", order.shop().key(), null, 200);
            } catch (Exception ex) {
                throw new IllegalStateException(ex);
            }
        });
        pay(order, 409);
        String reference = jdbc.queryForObject("SELECT payment_reference FROM payments WHERE order_id=?", String.class, order.orderId());
        // The cancel found the attempt PENDING (no link yet) and the superseded path cancels the link created right afterwards.
        assertThat(gateway.cancels()).hasSize(2).allSatisfy(c -> assertThat(c).containsExactly(reference, "ORDER_CANCELLED"));
    }

    @Test
    void concurrentCreateRequestsProduceAtMostOneAttempt() throws Exception {
        var order = placeOrder();
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
            var order = placeOrder();
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
