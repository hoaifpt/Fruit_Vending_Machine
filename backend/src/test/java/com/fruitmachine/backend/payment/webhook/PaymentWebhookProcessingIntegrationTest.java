package com.fruitmachine.backend.payment.webhook;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.support.AbstractWebhookIntegrationTest;
import com.fruitmachine.backend.support.ControllableGateway.Mode;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class PaymentWebhookProcessingIntegrationTest extends AbstractWebhookIntegrationTest {
    private PlacedOrder payable() throws Exception {
        var order = placeOrder();
        pay(order, 201);
        return order;
    }

    private String reference(PlacedOrder order) {
        return referenceOf(order.orderId());
    }

    private long inventory(Shop shop, String status) {
        return count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status=?", shop.slotId(), status);
    }

    @Test
    void successMakesThePaymentSuccessAndTheOrderPaidAndLeavesInventoryReserved() throws Exception {
        var order = payable();
        String reference = reference(order);
        assertThat(paid(reference, "TXN-1", orderTotal(order.orderId()))).isEqualTo(200);

        var payment = jdbc.queryForMap("SELECT status, transaction_id, paid_at, created_at FROM payments WHERE payment_reference=?", reference);
        assertThat(payment.get("status")).isEqualTo("SUCCESS");
        assertThat(payment.get("transaction_id")).isEqualTo("TXN-1");
        assertThat((java.sql.Timestamp) payment.get("paid_at")).isAfterOrEqualTo((java.sql.Timestamp) payment.get("created_at"));
        var row = jdbc.queryForMap("SELECT status, paid_at, completed_at, cancelled_at FROM orders WHERE id=?", order.orderId());
        assertThat(row.get("status")).isEqualTo("PAID");
        assertThat(row.get("paid_at")).isNotNull();
        assertThat(row.get("completed_at")).isNull();
        assertThat(row.get("cancelled_at")).isNull();
        // Reservation only: nothing is sold or dispensed yet and no anomaly exists; exactly one dispense command waits
        // for delivery (MQTT is disabled in tests, so it stays PENDING; docs/mqtt-dispense.md).
        assertThat(inventory(order.shop(), "RESERVED")).isEqualTo(1);
        assertThat(inventory(order.shop(), "SOLD")).isZero();
        assertThat(count("SELECT count(*) FROM order_item_allocations a JOIN order_items oi ON oi.id=a.order_item_id WHERE oi.order_id=? AND a.status='RESERVED'", order.orderId())).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM order_item_allocations a JOIN order_items oi ON oi.id=a.order_item_id WHERE oi.order_id=? AND a.status<>'RESERVED'", order.orderId())).isZero();
        assertThat(count("SELECT count(*) FROM dispense_commands WHERE order_id=?", order.orderId())).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM dispense_commands WHERE order_id=? AND status='PENDING'", order.orderId())).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM audit_logs WHERE entity_id=?", paymentId(reference))).isZero();
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE reference_id=? AND type IN ('SALE','RETURN')", order.orderId())).isZero();
    }

    @Test
    void anOrderPastItsExpiryButStillPendingPaymentIsStillPaid() throws Exception {
        var order = payable();
        clock.advance(Duration.ofMinutes(6));
        assertThat(orderStatus(order.orderId())).isEqualTo("PENDING_PAYMENT");
        assertThat(paid(reference(order), "TXN-LATE-SWEEP", orderTotal(order.orderId()))).isEqualTo(200);
        assertThat(orderStatus(order.orderId())).isEqualTo("PAID");
        assertThat(inventory(order.shop(), "RESERVED")).isEqualTo(1);
        // The sweep that runs afterwards must not touch a PAID order or its bowls.
        assertThat(expiry.sweep()).isZero();
        assertThat(orderStatus(order.orderId())).isEqualTo("PAID");
        assertThat(inventory(order.shop(), "RESERVED")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM inventory_transactions WHERE reference_id=? AND type='RETURN'", order.orderId())).isZero();
    }

    @Test
    void otherPendingAttemptsAreExpiredAndTheirProviderLinksCancelledAfterCommit() throws Exception {
        var order = payable();
        String other = insertPendingAttempt(order.orderId(), "TEST-OTHER-1", orderTotal(order.orderId()));
        String reference = reference(order);
        // Make the paying attempt the newest by reference lookup: use the one created through the kiosk API.
        String paying = jdbc.queryForObject("SELECT payment_reference FROM payments WHERE order_id=? AND payment_reference<>?", String.class, order.orderId(), other);
        assertThat(paid(paying, "TXN-PAYING", orderTotal(order.orderId()))).isEqualTo(200);
        assertThat(paymentStatus(paying)).isEqualTo("SUCCESS");
        assertThat(paymentStatus(other)).isEqualTo("EXPIRED");
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=? AND status='PENDING'", order.orderId())).isZero();
        assertThat(gateway.cancels()).hasSize(1);
        assertThat(gateway.cancels().get(0)).containsExactly(other, "ORDER_PAID");
        assertThat(reference).isNotBlank();
    }

    @Test
    void kioskPollingShowsPaidAndASuccessfulPayment() throws Exception {
        var order = payable();
        assertThat(kioskOrder(order).path("status").asText()).isEqualTo("PENDING_PAYMENT");
        paid(reference(order), "TXN-POLL", orderTotal(order.orderId()));
        var polled = kioskOrder(order);
        assertThat(polled.path("status").asText()).isEqualTo("PAID");
        assertThat(polled.path("currentPayment").path("status").asText()).isEqualTo("SUCCESS");
        assertThat(polled.path("currentPayment").path("qrCode").isNull()).isTrue();
        // A paid order can no longer be cancelled by the kiosk or receive a new payment attempt.
        kioskJson("POST", "/api/v1/kiosk/orders/" + order.orderId() + "/cancel", order.shop().key(), null, 409);
        pay(order, 409);
        assertThat(inventory(order.shop(), "RESERVED")).isEqualTo(1);
    }

    @Test
    void expiredAndFailedAttemptsStillBecomeSuccessWhenTheMoneyArrived() throws Exception {
        var order = placeOrder();
        pay(order, 201);
        String first = reference(order);
        clock.advance(Duration.ofMinutes(2).plusSeconds(1));
        pay(order, 201);
        assertThat(paymentStatus(first)).isEqualTo("EXPIRED");
        assertThat(paid(first, "TXN-EXPIRED-ATTEMPT", orderTotal(order.orderId()))).isEqualTo(200);
        assertThat(paymentStatus(first)).isEqualTo("SUCCESS");
        assertThat(orderStatus(order.orderId())).isEqualTo("PAID");

        var failedOrder = placeOrder();
        gateway.mode(Mode.FAIL);
        pay(failedOrder, 502);
        gateway.mode(Mode.SUCCESS);
        String failed = reference(failedOrder);
        assertThat(paymentStatus(failed)).isEqualTo("FAILED");
        assertThat(paid(failed, "TXN-FAILED-ATTEMPT", orderTotal(failedOrder.orderId()))).isEqualTo(200);
        assertThat(paymentStatus(failed)).isEqualTo("SUCCESS");
        assertThat(orderStatus(failedOrder.orderId())).isEqualTo("PAID");
    }

    @Test
    void theSameWebhookDeliveredTwiceIsAnIdempotentNoOp() throws Exception {
        var order = payable();
        String reference = reference(order);
        String body = webhookBody(reference, "TXN-DUP", orderTotal(order.orderId()), "SUCCESS");
        assertThat(webhook(WEBHOOK, body, sign(body)).getResponse().getStatus()).isEqualTo(200);
        var before = jdbc.queryForMap("SELECT paid_at, transaction_id FROM payments WHERE payment_reference=?", reference);
        var orderBefore = jdbc.queryForMap("SELECT paid_at FROM orders WHERE id=?", order.orderId());
        for (int i = 0; i < 3; i++) assertThat(webhook(WEBHOOK, body, sign(body)).getResponse().getStatus()).isEqualTo(200);
        assertThat(jdbc.queryForMap("SELECT paid_at, transaction_id FROM payments WHERE payment_reference=?", reference)).isEqualTo(before);
        assertThat(jdbc.queryForMap("SELECT paid_at FROM orders WHERE id=?", order.orderId())).isEqualTo(orderBefore);
        assertThat(count("SELECT count(*) FROM audit_logs WHERE entity_id=?", paymentId(reference))).isZero();
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=? AND status='SUCCESS'", order.orderId())).isEqualTo(1);
        // Every delivery is still evidence.
        assertThat(count("SELECT count(*) FROM payment_webhook_logs WHERE order_code=?", reference)).isEqualTo(4);
    }

    @Test
    void parallelDeliveriesOfTheSameWebhookChangeStateExactlyOnce() throws Exception {
        for (int round = 0; round < 3; round++) {
            var order = payable();
            String reference = reference(order);
            String body = webhookBody(reference, "TXN-PAR-" + round, orderTotal(order.orderId()), "SUCCESS");
            List<Integer> statuses = parallel(java.util.stream.IntStream.range(0, 6).<java.util.concurrent.Callable<Integer>>mapToObj(
                    i -> () -> webhook(WEBHOOK, body, sign(body)).getResponse().getStatus()).toList());
            assertThat(statuses).containsOnly(200);
            assertThat(paymentStatus(reference)).isEqualTo("SUCCESS");
            assertThat(orderStatus(order.orderId())).isEqualTo("PAID");
            assertThat(count("SELECT count(*) FROM payments WHERE order_id=? AND status='SUCCESS'", order.orderId())).isEqualTo(1);
            assertThat(count("SELECT count(*) FROM audit_logs WHERE entity_id=?", paymentId(reference))).isZero();
            assertThat(inventory(order.shop(), "RESERVED")).isEqualTo(1);
        }
    }

    @Test
    void aTransactionIdAlreadyUsedByAnotherPaymentIsAConflictAndChangesNothing() throws Exception {
        var first = payable();
        var second = payable();
        paid(reference(first), "TXN-SHARED", orderTotal(first.orderId()));
        String secondReference = reference(second);
        assertThat(paid(secondReference, "TXN-SHARED", orderTotal(second.orderId()))).isEqualTo(200);
        assertThat(paymentStatus(secondReference)).isEqualTo("PENDING");
        assertThat(orderStatus(second.orderId())).isEqualTo("PENDING_PAYMENT");
        assertThat(auditCount("PAYMENT_TRANSACTION_CONFLICT", paymentId(secondReference))).isEqualTo(1);
        assertThat(orderStatus(first.orderId())).isEqualTo("PAID");
    }

    @Test
    void aSuccessPaymentReceivingADifferentTransactionIdKeepsItsOwnAndRecordsAConflict() throws Exception {
        var order = payable();
        String reference = reference(order);
        paid(reference, "TXN-A", orderTotal(order.orderId()));
        assertThat(paid(reference, "TXN-B", orderTotal(order.orderId()))).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT transaction_id FROM payments WHERE payment_reference=?", String.class, reference)).isEqualTo("TXN-A");
        assertThat(auditCount("PAYMENT_TRANSACTION_CONFLICT", paymentId(reference))).isEqualTo(1);
        assertThat(orderStatus(order.orderId())).isEqualTo("PAID");
    }

    @Test
    void twoPaymentsRacingForTheSameTransactionIdYieldOneSuccessAndOneRecordedConflict() throws Exception {
        for (int round = 0; round < 3; round++) {
            var first = payable();
            var second = payable();
            String shared = "TXN-RACE-" + round;
            String firstReference = reference(first), secondReference = reference(second);
            String firstBody = webhookBody(firstReference, shared, orderTotal(first.orderId()), "SUCCESS");
            String secondBody = webhookBody(secondReference, shared, orderTotal(second.orderId()), "SUCCESS");
            List<Integer> statuses = parallel(List.of(() -> webhook(WEBHOOK, firstBody, sign(firstBody)).getResponse().getStatus(),
                    () -> webhook(WEBHOOK, secondBody, sign(secondBody)).getResponse().getStatus()));
            assertThat(statuses).containsExactly(200, 200);
            long successes = count("SELECT count(*) FROM payments WHERE payment_reference IN (?,?) AND status='SUCCESS'", firstReference, secondReference);
            assertThat(successes).isEqualTo(1);
            assertThat(auditCount("PAYMENT_TRANSACTION_CONFLICT", paymentId(firstReference)) + auditCount("PAYMENT_TRANSACTION_CONFLICT", paymentId(secondReference))).isEqualTo(1);
            // The loser's order did not become PAID.
            assertThat(count("SELECT count(*) FROM orders WHERE id IN (?,?) AND status='PAID'", first.orderId(), second.orderId())).isEqualTo(1);
        }
    }

    @Test
    void anAmountMismatchChangesNothingAndIsRecorded() throws Exception {
        var order = payable();
        String reference = reference(order);
        assertThat(paid(reference, "TXN-AMT", "69999.99")).isEqualTo(200);
        assertThat(paymentStatus(reference)).isEqualTo("PENDING");
        assertThat(orderStatus(order.orderId())).isEqualTo("PENDING_PAYMENT");
        assertThat(jdbc.queryForObject("SELECT transaction_id FROM payments WHERE payment_reference=?", String.class, reference)).isNull();
        UUID id = paymentId(reference);
        assertThat(auditCount("PAYMENT_AMOUNT_MISMATCH", id)).isEqualTo(1);
        JsonNode after = auditValue("PAYMENT_AMOUNT_MISMATCH", id, "new_value");
        assertThat(after.path("amountReceived").asText()).isEqualTo("69999.99");
        assertThat(after.path("amountExpected").asText()).isEqualTo("35000.00");
        assertThat(after.path("transactionId").asText()).isEqualTo("TXN-AMT");
        assertThat(auditValue("PAYMENT_AMOUNT_MISMATCH", id, "old_value").path("paymentStatus").asText()).isEqualTo("PENDING");
        assertThat(inventory(order.shop(), "RESERVED")).isEqualTo(1);
        // A missing amount on a success event is also not accepted.
        String noAmount = "{\"paymentReference\":\"" + reference + "\",\"transactionId\":\"TXN-NA\",\"status\":\"SUCCESS\"}";
        assertThat(webhook(WEBHOOK, noAmount, sign(noAmount)).getResponse().getStatus()).isEqualTo(200);
        assertThat(paymentStatus(reference)).isEqualTo("PENDING");
    }

    @Test
    void amountsAreComparedNumericallyNotAsText() throws Exception {
        var order = payable();
        String reference = reference(order);
        // 35000 and 3.5E4 and 35000.000 all equal 35000.00 under BigDecimal.compareTo.
        assertThat(paid(reference, "TXN-CMP", "3.5E4")).isEqualTo(200);
        assertThat(paymentStatus(reference)).isEqualTo("SUCCESS");
        var second = payable();
        assertThat(paid(reference(second), "TXN-CMP-2", "35000.000")).isEqualTo(200);
        assertThat(paymentStatus(reference(second))).isEqualTo("SUCCESS");
        var third = payable();
        assertThat(paid(reference(third), "TXN-CMP-3", "35000")).isEqualTo(200);
        assertThat(orderStatus(third.orderId())).isEqualTo("PAID");
    }

    @Test
    void aPaymentForACancelledOrderIsRecordedAsLateWithoutReReservingOrRefunding() throws Exception {
        var order = payable();
        String reference = reference(order);
        kioskJson("POST", "/api/v1/kiosk/orders/" + order.orderId() + "/cancel", order.shop().key(), null, 200);
        assertThat(inventory(order.shop(), "AVAILABLE")).isEqualTo(3);
        assertThat(paid(reference, "TXN-LATE", orderTotal(order.orderId()))).isEqualTo(200);
        assertThat(paymentStatus(reference)).isEqualTo("SUCCESS");
        assertThat(orderStatus(order.orderId())).isEqualTo("CANCELLED");
        // No re-reservation: the bowls stay available.
        assertThat(inventory(order.shop(), "AVAILABLE")).isEqualTo(3);
        assertThat(inventory(order.shop(), "RESERVED")).isZero();
        UUID id = paymentId(reference);
        assertThat(auditCount("PAYMENT_LATE", id)).isEqualTo(1);
        assertThat(auditValue("PAYMENT_LATE", id, "old_value").path("orderStatus").asText()).isEqualTo("CANCELLED");
        assertThat(auditValue("PAYMENT_LATE", id, "old_value").path("paymentStatus").asText()).isEqualTo("EXPIRED");
        assertThat(auditValue("PAYMENT_LATE", id, "new_value").path("paymentStatus").asText()).isEqualTo("SUCCESS");
        assertThat(count("SELECT count(*) FROM audit_logs WHERE entity_id=? AND user_id IS NOT NULL", id)).isZero();
        assertThat(count("SELECT count(*) FROM payments WHERE status='REFUNDED'")).isZero();
    }

    @Test
    void aSecondSuccessfulAttemptOnAPaidOrderIsRecordedAsDuplicate() throws Exception {
        var order = payable();
        String first = reference(order);
        paid(first, "TXN-FIRST", orderTotal(order.orderId()));
        String second = insertPendingAttempt(order.orderId(), "TEST-SECOND-QR", orderTotal(order.orderId()));
        assertThat(paid(second, "TXN-SECOND", orderTotal(order.orderId()))).isEqualTo(200);
        assertThat(paymentStatus(second)).isEqualTo("SUCCESS");
        assertThat(orderStatus(order.orderId())).isEqualTo("PAID");
        assertThat(auditCount("PAYMENT_DUPLICATE", paymentId(second))).isEqualTo(1);
        assertThat(auditCount("PAYMENT_DUPLICATE", paymentId(first))).isZero();
        assertThat(inventory(order.shop(), "RESERVED")).isEqualTo(1);
    }

    @Test
    void anUnknownReferenceIsAcknowledgedAndOnlyLogged() throws Exception {
        long audits = count("SELECT count(*) FROM audit_logs");
        long payments = count("SELECT count(*) FROM payments WHERE status='SUCCESS'");
        assertThat(paid("DOES-NOT-EXIST", "TXN-UNK", "1000")).isEqualTo(200);
        assertThat(count("SELECT count(*) FROM audit_logs")).isEqualTo(audits);
        assertThat(count("SELECT count(*) FROM payments WHERE status='SUCCESS'")).isEqualTo(payments);
        assertThat(count("SELECT count(*) FROM payment_webhook_logs WHERE order_code='DOES-NOT-EXIST' AND is_verified")).isEqualTo(1);
    }

    @Test
    void failedEventsOnlyMoveAPendingPaymentToFailed() throws Exception {
        var order = payable();
        String reference = reference(order);
        String failed = webhookBody(reference, "null", orderTotal(order.orderId()), "FAILED").replace("\"null\"", "null");
        assertThat(webhook(WEBHOOK, failed, sign(failed)).getResponse().getStatus()).isEqualTo(200);
        assertThat(paymentStatus(reference)).isEqualTo("FAILED");
        assertThat(orderStatus(order.orderId())).isEqualTo("PENDING_PAYMENT");
        assertThat(inventory(order.shop(), "RESERVED")).isEqualTo(1);
        assertThat(webhook(WEBHOOK, failed, sign(failed)).getResponse().getStatus()).isEqualTo(200);
        assertThat(paymentStatus(reference)).isEqualTo("FAILED");
        // The kiosk may try again while the order is still payable.
        pay(order, 201);

        var paidOrder = payable();
        String paidReference = reference(paidOrder);
        paid(paidReference, "TXN-F", orderTotal(paidOrder.orderId()));
        String ignored = webhookBody(paidReference, "null", orderTotal(paidOrder.orderId()), "FAILED").replace("\"null\"", "null");
        assertThat(webhook(WEBHOOK, ignored, sign(ignored)).getResponse().getStatus()).isEqualTo(200);
        assertThat(paymentStatus(paidReference)).isEqualTo("SUCCESS");
        assertThat(orderStatus(paidOrder.orderId())).isEqualTo("PAID");
        // A failed notification for a different amount is an anomaly, not a state change.
        var mismatch = payable();
        String wrong = webhookBody(reference(mismatch), "null", "1", "FAILED").replace("\"null\"", "null");
        assertThat(webhook(WEBHOOK, wrong, sign(wrong)).getResponse().getStatus()).isEqualTo(200);
        assertThat(paymentStatus(reference(mismatch))).isEqualTo("PENDING");
    }

    @Test
    void aRefundedPaymentIsNeverTouchedByASuccessWebhook() throws Exception {
        var order = payable();
        String reference = reference(order);
        jdbc.update("UPDATE payments SET status='REFUNDED', transaction_id='TXN-OLD', paid_at=now() WHERE payment_reference=?", reference);
        assertThat(paid(reference, "TXN-OLD", orderTotal(order.orderId()))).isEqualTo(200);
        assertThat(paymentStatus(reference)).isEqualTo("REFUNDED");
        assertThat(orderStatus(order.orderId())).isEqualTo("PENDING_PAYMENT");
    }

    @Test
    void requiresAttentionListsLateAndDuplicatePaymentsOnly() throws Exception {
        var shop = shopWithSlots(4);
        var normal = placeOrder(shop);
        pay(normal, 201);
        var late = placeOrder(shop);
        pay(late, 201);
        var duplicate = placeOrder(shop);
        pay(duplicate, 201);
        var pending = placeOrder(shop);
        pay(pending, 201);

        paid(reference(normal), "TXN-N", orderTotal(normal.orderId()));
        String lateRef = reference(late);
        kioskJson("POST", "/api/v1/kiosk/orders/" + late.orderId() + "/cancel", shop.key(), null, 200);
        paid(lateRef, "TXN-L", orderTotal(late.orderId()));
        String firstRef = reference(duplicate);
        paid(firstRef, "TXN-D1", orderTotal(duplicate.orderId()));
        String secondRef = insertPendingAttempt(duplicate.orderId(), "TEST-DUP-2", orderTotal(duplicate.orderId()));
        paid(secondRef, "TXN-D2", orderTotal(duplicate.orderId()));

        var page = fixtures.api("GET", "/api/v1/payments?requiresAttention=true&machineId=" + shop.machineId() + "&size=50", null, admin.token(), 200);
        Set<String> ids = page.path("content").findValuesAsText("id").stream().collect(Collectors.toSet());
        assertThat(ids).containsExactlyInAnyOrder(paymentId(lateRef).toString(), paymentId(firstRef).toString(), paymentId(secondRef).toString());
        assertThat(page.path("content")).allSatisfy(item -> assertThat(item.path("status").asText()).isEqualTo("SUCCESS"));
        var all = fixtures.api("GET", "/api/v1/payments?machineId=" + shop.machineId() + "&size=50", null, admin.token(), 200);
        assertThat(all.path("totalElements").asInt()).isGreaterThan(page.path("totalElements").asInt());
        var off = fixtures.api("GET", "/api/v1/payments?requiresAttention=false&machineId=" + shop.machineId() + "&size=50", null, admin.token(), 200);
        assertThat(off.path("totalElements")).isEqualTo(all.path("totalElements"));
    }
}
