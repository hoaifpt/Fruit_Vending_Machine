package com.fruitmachine.backend.payment;

import com.fruitmachine.backend.payment.service.PaymentService;
import com.fruitmachine.backend.security.kiosk.AuthenticatedKiosk;
import com.fruitmachine.backend.support.AbstractPaymentIntegrationTest;
import com.fruitmachine.backend.support.ControllableGateway.Mode;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PaymentAttemptIntegrationTest extends AbstractPaymentIntegrationTest {
    @Autowired PaymentService paymentService;
    @Autowired TransactionTemplate transactions;

    @Test
    void kioskCreatesAttemptWithOrderAmountReferenceQrAndDeadline() throws Exception {
        var order = placeOrder(2);
        Instant before = Instant.now();
        var created = pay(order, 201).path("data");
        Instant after = Instant.now();
        assertThat(created.path("status").asText()).isEqualTo("PENDING");
        assertThat(created.path("provider").asText()).isEqualTo("TESTPAY");
        assertThat(created.path("orderId").asText()).isEqualTo(order.orderId().toString());
        assertThat(created.path("amount").decimalValue()).isEqualByComparingTo("70000");
        assertThat(created.path("qrCode").asText()).startsWith("TEST-QR|TEST-").endsWith("|70000.00");
        // attempt-ttl is 2 minutes, shorter than the 5 minute reservation.
        assertThat(Instant.parse(created.path("expiresAt").asText())).isBetween(before.plus(Duration.ofMinutes(2)).minusMillis(1), after.plus(Duration.ofMinutes(2)).plusMillis(1));
        var row = jdbc.queryForMap("SELECT provider, payment_reference, qr_code, amount, status, transaction_id, paid_at FROM payments WHERE id=?", UUID.fromString(created.path("paymentId").asText()));
        assertThat(row.get("provider")).isEqualTo("TESTPAY");
        assertThat((String) row.get("payment_reference")).startsWith("TEST-");
        assertThat((String) row.get("qr_code")).contains((String) row.get("payment_reference"));
        assertThat((java.math.BigDecimal) row.get("amount")).isEqualByComparingTo(jdbc.queryForObject("SELECT total_amount FROM orders WHERE id=?", java.math.BigDecimal.class, order.orderId()));
        assertThat(row.get("status")).isEqualTo("PENDING");
        assertThat(row.get("transaction_id")).isNull();
        assertThat(row.get("paid_at")).isNull();
        assertThat(gateway.requests()).hasSize(1);
        assertThat(gateway.requests().get(0).orderCode()).isEqualTo(order.orderCode());
    }

    @Test
    void qrDeadlineNeverOutlivesTheOrderReservation() throws Exception {
        var order = placeOrder(1);
        Instant orderExpiry = instant("SELECT expires_at FROM orders WHERE id=?", order.orderId());
        clock.advance(Duration.ofMinutes(4));
        var created = pay(order, 201).path("data");
        // now + 2 minutes would be after the reservation deadline, so the deadline is capped.
        assertThat(Instant.parse(created.path("expiresAt").asText())).isEqualTo(orderExpiry);
        assertThat(instant("SELECT expired_at FROM payments WHERE id=?", UUID.fromString(created.path("paymentId").asText()))).isEqualTo(orderExpiry);
    }

    @Test
    void providerDeadlineShorterThanOursIsHonored() throws Exception {
        var order = placeOrder(1);
        Instant providerLimit = Instant.now().plus(Duration.ofSeconds(45));
        gateway.providerExpiresAt(providerLimit);
        var created = pay(order, 201).path("data");
        assertThat(Instant.parse(created.path("expiresAt").asText())).isEqualTo(providerLimit.truncatedTo(java.time.temporal.ChronoUnit.MICROS));
    }

    @Test
    void repeatedRequestReusesTheLiveAttemptWithoutCallingTheProviderAgain() throws Exception {
        var order = placeOrder(1);
        var first = pay(order, 201).path("data");
        var second = pay(order, 200).path("data");
        var third = pay(order, 200).path("data");
        assertThat(second).isEqualTo(first);
        assertThat(third).isEqualTo(first);
        assertThat(gateway.calls()).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=?", order.orderId())).isEqualTo(1);
    }

    @Test
    void expiredPendingAttemptBecomesExpiredAndANewAttemptIsCreated() throws Exception {
        var order = placeOrder(1);
        var first = pay(order, 201).path("data");
        clock.advance(Duration.ofMinutes(2).plusSeconds(1));
        var second = pay(order, 201).path("data");
        assertThat(second.path("paymentId")).isNotEqualTo(first.path("paymentId"));
        assertThat(second.path("qrCode")).isNotEqualTo(first.path("qrCode"));
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE id=?", String.class, UUID.fromString(first.path("paymentId").asText()))).isEqualTo("EXPIRED");
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=?", order.orderId())).isEqualTo(2);
        assertThat(orderStatus(order.orderId())).isEqualTo("PENDING_PAYMENT");
        // The unique reference index kept both attempts distinct.
        assertThat(count("SELECT count(DISTINCT payment_reference) FROM payments WHERE order_id=?", order.orderId())).isEqualTo(2);
    }

    @Test
    void attemptStillBeingCreatedAnswers409() throws Exception {
        var order = placeOrder(1);
        jdbc.update("INSERT INTO payments(order_id, provider, payment_reference, amount, status, expired_at) VALUES (?, 'TESTPAY', 'TEST-INFLIGHT', 1, 'PENDING', now() + interval '1 minute')", order.orderId());
        pay(order, 409);
        assertThat(gateway.calls()).isZero();
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=?", order.orderId())).isEqualTo(1);
    }

    @Test
    void maximumAttemptsPerOrderIsEnforced() throws Exception {
        var order = placeOrder(1);
        gateway.mode(Mode.FAIL);
        for (int i = 0; i < 3; i++) pay(order, 502);
        gateway.mode(Mode.SUCCESS);
        pay(order, 409);
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=? AND status='FAILED'", order.orderId())).isEqualTo(3);
        assertThat(gateway.calls()).isEqualTo(3);
    }

    @Test
    void orderThatIsNotPendingPaymentOrAlmostExpiredCannotStartAPayment() throws Exception {
        var cancelled = placeOrder(1);
        kioskJson("POST", "/api/v1/kiosk/orders/" + cancelled.orderId() + "/cancel", cancelled.shop().key(), null, 200);
        pay(cancelled, 409);
        var other = placeOrder(1);
        // PAID is produced only by a later issue; simulate a backend-confirmed state directly.
        jdbc.update("UPDATE orders SET status='PAID', paid_at=now() WHERE id=?", other.orderId());
        pay(other, 409);
        var late = placeOrder(1);
        clock.advance(Duration.ofMinutes(4).plusSeconds(40));
        pay(late, 409);
        clock.reset();
        var expired = placeOrder(1);
        clock.advance(Duration.ofMinutes(6));
        pay(expired, 409);
        assertThat(gateway.calls()).isZero();
        assertThat(count("SELECT count(*) FROM payments WHERE order_id IN (?,?,?,?)", cancelled.orderId(), other.orderId(), late.orderId(), expired.orderId())).isZero();
    }

    @Test
    void orderOfAnotherMachineOrMissingOrderIs404AndAuthenticationIsRequired() throws Exception {
        var order = placeOrder(1);
        var other = shop(2);
        kioskJson("POST", order.payments(), other.key(), null, 404);
        kioskJson("POST", "/api/v1/kiosk/orders/" + UUID.randomUUID() + "/payments", order.shop().key(), null, 404);
        assertThat(kioskCall("POST", order.payments(), null, null).getResponse().getStatus()).isEqualTo(401);
        assertThat(kioskCall("POST", order.payments(), "fvk_aaaaaaaaaaaa_" + "A".repeat(43), null).getResponse().getStatus()).isEqualTo(401);
        fixtures.response("POST", order.payments(), null, admin.token(), 403);
        fixtures.response("POST", order.payments(), null, staff.token(), 403);
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=?", order.orderId())).isZero();
    }

    @Test
    void providerFailureMarksTheAttemptFailedReturns502AndLeavesTheOrderUnchanged() throws Exception {
        var order = placeOrder(1);
        gateway.mode(Mode.FAIL);
        var error = pay(order, 502);
        assertThat(error.path("message").asText()).isEqualTo("Payment provider is currently unavailable");
        assertThat(error.toString()).doesNotContain("test provider rejected", "TESTPAY");
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE order_id=?", String.class, order.orderId())).isEqualTo("FAILED");
        assertThat(jdbc.queryForObject("SELECT qr_code FROM payments WHERE order_id=?", String.class, order.orderId())).isNull();
        assertThat(orderStatus(order.orderId())).isEqualTo("PENDING_PAYMENT");
        gateway.mode(Mode.BLANK_QR);
        pay(order, 502);
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=? AND status='FAILED'", order.orderId())).isEqualTo(2);
        // The kiosk may try again while the order is still payable.
        gateway.mode(Mode.SUCCESS);
        pay(order, 201);
    }

    @Test
    void providerTimeoutMarksTheAttemptFailedAndReturns502() throws Exception {
        var order = placeOrder(1);
        gateway.mode(Mode.TIMEOUT);
        long started = System.nanoTime();
        pay(order, 502);
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(15));
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE order_id=?", String.class, order.orderId())).isEqualTo("FAILED");
        assertThat(orderStatus(order.orderId())).isEqualTo("PENDING_PAYMENT");
    }

    @Test
    void noDatabaseTransactionIsOpenWhileTheProviderIsCalled() throws Exception {
        var order = placeOrder(1);
        pay(order, 201);
        assertThat(gateway.idleInTransactionDuringCall()).containsExactly(0L);
        // The service refuses to run inside an ambient transaction at all.
        SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(
                new AuthenticatedKiosk(UUID.randomUUID(), order.shop().machineId(), "X"), null, List.of(new SimpleGrantedAuthority("ROLE_KIOSK"))));
        try {
            assertThatThrownBy(() -> transactions.executeWithoutResult(status ->
                    paymentService.createOrReuseAttempt(new AuthenticatedKiosk(UUID.randomUUID(), order.shop().machineId(), "X"), order.orderId())))
                    .isInstanceOf(IllegalStateException.class).hasMessageContaining("inside a database transaction");
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    @Test
    void orderCancelledDuringTheProviderCallKeepsTheAttemptExpiredAndAnswers409() throws Exception {
        var order = placeOrder(2);
        gateway.duringCall(() -> {
            try {
                kioskJson("POST", "/api/v1/kiosk/orders/" + order.orderId() + "/cancel", order.shop().key(), null, 200);
            } catch (Exception ex) {
                throw new IllegalStateException(ex);
            }
        });
        pay(order, 409);
        assertThat(jdbc.queryForObject("SELECT status FROM payments WHERE order_id=?", String.class, order.orderId())).isEqualTo("EXPIRED");
        assertThat(jdbc.queryForObject("SELECT qr_code FROM payments WHERE order_id=?", String.class, order.orderId())).isNull();
        assertThat(orderStatus(order.orderId())).isEqualTo("CANCELLED");
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=? AND status='PENDING'", order.orderId())).isZero();
    }

    @Test
    void anAmountTheProviderCannotChargeExactlyIsRejectedBeforeAnyAttemptIsInserted() throws Exception {
        gateway.wholeAmountsOnly(true);
        UUID machine = fixtures.machine(admin.token());
        UUID slot = createSlot(machine, "F1", 10), product = createProduct("Fractional bowl", "35000.50");
        load(fixtures.batch(product, 3, staff.token()), slot, 3);
        String key = issueKey(machine);
        var fractional = new PlacedOrder(new Shop(machine, slot, product, key),
                UUID.fromString(kioskData("POST", "/api/v1/kiosk/orders", key, orderBody(line(product, 1)), 201).path("id").asText()), "x");
        var error = pay(fractional, 409);
        assertThat(error.path("message").asText()).contains("cannot be charged");
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=?", fractional.orderId())).isZero();
        assertThat(gateway.calls()).isZero();
        // The same provider accepts a whole amount, and the default (MOCK-like) rule accepts fractions.
        pay(placeOrder(1), 201);
        gateway.wholeAmountsOnly(false);
        pay(fractional, 201);
    }

    @Test
    void aCollidingReferenceIsRegeneratedInsteadOfFailing() throws Exception {
        var other = placeOrder(1);
        jdbc.update("INSERT INTO payments(order_id, provider, payment_reference, amount, status, expired_at) VALUES (?, 'TESTPAY', 'TEST-DUPLICATE', 1, 'FAILED', now() + interval '1 minute')", other.orderId());
        var order = placeOrder(1);
        gateway.queueReferences("TEST-DUPLICATE", "TEST-DUPLICATE", "TEST-FRESH-1");
        pay(order, 201);
        assertThat(jdbc.queryForObject("SELECT payment_reference FROM payments WHERE order_id=?", String.class, order.orderId())).isEqualTo("TEST-FRESH-1");
        assertThat(count("SELECT count(*) FROM payments WHERE provider='TESTPAY' AND payment_reference='TEST-DUPLICATE'")).isEqualTo(1);
    }

    @Test
    void amountAndOtherValuesFromTheClientAreIgnored() throws Exception {
        var order = placeOrder(1);
        var created = kioskJson("POST", order.payments(), order.shop().key(), Map.of("amount", 1, "provider", "MOCK", "status", "SUCCESS"), 201).path("data");
        assertThat(created.path("amount").decimalValue()).isEqualByComparingTo("35000");
        assertThat(created.path("provider").asText()).isEqualTo("TESTPAY");
        assertThat(created.path("status").asText()).isEqualTo("PENDING");
    }
}
