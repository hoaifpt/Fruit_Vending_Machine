package com.fruitmachine.backend.payment.payos;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.order.repository.OrderRepository;
import com.fruitmachine.backend.payment.gateway.PaymentGatewayRegistry;
import com.fruitmachine.backend.payment.service.PaymentService;
import com.fruitmachine.backend.support.AbstractOrderIntegrationTest;
import com.fruitmachine.backend.support.StubPayOsServer;
import com.fruitmachine.backend.support.StubPayOsServer.Mode;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/** PAYMENT_PROVIDER=PAYOS with a loopback stub and real PostgreSQL; the real payOS is never contacted. */
@ExtendWith(OutputCaptureExtension.class)
class PayOsIntegrationTest extends AbstractOrderIntegrationTest {
    static final StubPayOsServer STUB = new StubPayOsServer();
    static final String CLIENT_ID = "it-client-id-3f9a";
    static final String API_KEY = "it-api-key-8c21";
    static final String CHECKSUM = "it-checksum-key-b07d";

    @DynamicPropertySource
    static void payos(DynamicPropertyRegistry registry) {
        registry.add("app.payment.provider", () -> "PAYOS");
        registry.add("app.payment.attempt-ttl", () -> "PT2M");
        registry.add("app.payment.provider-timeout", () -> "PT3S");
        registry.add("app.payment.payos.base-url", STUB::baseUrl);
        registry.add("app.payment.payos.client-id", () -> CLIENT_ID);
        registry.add("app.payment.payos.api-key", () -> API_KEY);
        registry.add("app.payment.payos.checksum-key", () -> CHECKSUM);
        registry.add("app.payment.payos.return-url", () -> "https://shop.example.invalid/return");
        registry.add("app.payment.payos.cancel-url", () -> "https://shop.example.invalid/cancel");
        registry.add("app.payment.payos.cancel-timeout", () -> "PT1S");
    }

    @Autowired PaymentGatewayRegistry registry;
    @Autowired PaymentService paymentService;
    @Autowired OrderRepository orderRepository;
    @Autowired TransactionTemplate transactions;

    record Placed(UUID machineId, UUID slotId, UUID productId, String key, UUID orderId) {
        String payments() { return "/api/v1/kiosk/orders/" + orderId + "/payments"; }
    }

    @AfterAll
    static void stopStub() {
        STUB.close();
    }

    @BeforeEach
    void resetStub() {
        STUB.reset();
    }

    private Placed place(String price, int quantity) throws Exception {
        UUID machine = fixtures.machine(admin.token());
        UUID slot = createSlot(machine, "Q1", 20), product = createProduct("PayOS bowl", price);
        load(fixtures.batch(product, quantity + 1, staff.token()), slot, quantity + 1);
        String key = issueKey(machine);
        var order = kioskData("POST", "/api/v1/kiosk/orders", key, orderBody(line(product, quantity)), 201);
        return new Placed(machine, slot, product, key, UUID.fromString(order.path("id").asText()));
    }

    private long count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    private String paymentStatus(UUID orderId) {
        return jdbc.queryForObject("SELECT status FROM payments WHERE order_id=? ORDER BY created_at DESC, id DESC LIMIT 1", String.class, orderId);
    }

    @Test
    void payosIsTheActiveProviderAndTheKioskReceivesTheVietQrPayload() throws Exception {
        assertThat(registry.active().provider()).isEqualTo("PAYOS");
        var order = place("35000", 2);
        var created = kioskJson("POST", order.payments(), order.key(), null, 201).path("data");
        assertThat(created.path("provider").asText()).isEqualTo("PAYOS");
        assertThat(created.path("status").asText()).isEqualTo("PENDING");
        assertThat(created.path("amount").decimalValue()).isEqualByComparingTo("70000");
        assertThat(created.path("qrCode").asText()).isEqualTo("STUB-VIETQR-PAYLOAD");

        var row = jdbc.queryForMap("SELECT provider, payment_reference, qr_code, amount, status, expired_at FROM payments WHERE order_id=?", order.orderId());
        assertThat(row.get("provider")).isEqualTo("PAYOS");
        assertThat((String) row.get("payment_reference")).matches("[1-9][0-9]{14}");
        assertThat(row.get("qr_code")).isEqualTo("STUB-VIETQR-PAYLOAD");
        assertThat(STUB.creates()).hasSize(1);
        JsonNode sent = json.readTree(STUB.creates().get(0).body());
        assertThat(sent.get("orderCode").asLong()).isEqualTo(Long.parseLong((String) row.get("payment_reference")));
        assertThat(sent.get("amount").asLong()).isEqualTo(70000L);
        assertThat(sent.get("expiredAt").asLong()).isEqualTo(((java.sql.Timestamp) row.get("expired_at")).toInstant().getEpochSecond());
        assertThat(sent.get("description").asText()).matches("FV[A-Z0-9]{0,7}");
        // Reuse does not call payOS again.
        kioskJson("POST", order.payments(), order.key(), null, 200);
        assertThat(STUB.creates()).hasSize(1);
    }

    @Test
    void providerFailureMarksTheAttemptFailedReturns502AndLeavesTheOrderUnchanged() throws Exception {
        for (Mode mode : new Mode[]{Mode.HTTP_500, Mode.CODE_ERROR, Mode.BLANK_QR, Mode.GARBAGE}) {
            var order = place("35000", 1);
            STUB.createMode(mode);
            var error = kioskJson("POST", order.payments(), order.key(), null, 502);
            assertThat(error.path("message").asText()).isEqualTo("Payment provider is currently unavailable");
            assertThat(error.toString()).doesNotContain("secret-looking", "order already exists", API_KEY, CHECKSUM);
            assertThat(paymentStatus(order.orderId())).as("%s", mode).isEqualTo("FAILED");
            assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, order.orderId())).isEqualTo("PENDING_PAYMENT");
        }
    }

    @Test
    void providerTimeoutIsAFailedAttemptAnd502() throws Exception {
        var order = place("35000", 1);
        STUB.createMode(Mode.SLOW);
        STUB.slowMillis(6000);
        long started = System.nanoTime();
        kioskJson("POST", order.payments(), order.key(), null, 502);
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(5));
        assertThat(paymentStatus(order.orderId())).isEqualTo("FAILED");
    }

    @Test
    void anAmountPayosCannotChargeExactlyIsRejectedBeforeAnyAttemptExists() throws Exception {
        var order = place("35000.50", 1);
        var error = kioskJson("POST", order.payments(), order.key(), null, 409);
        assertThat(error.path("message").asText()).contains("cannot be charged");
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=?", order.orderId())).isZero();
        assertThat(STUB.calls()).isEmpty();
        // A whole-VND price on the same flow is accepted.
        var whole = place("35000.00", 1);
        kioskJson("POST", whole.payments(), whole.key(), null, 201);
    }

    @Test
    void kioskCancelExpiresTheAttemptAndOnlyThenCancelsTheProviderLink() throws Exception {
        var order = place("35000", 1);
        kioskJson("POST", order.payments(), order.key(), null, 201);
        String reference = jdbc.queryForObject("SELECT payment_reference FROM payments WHERE order_id=?", String.class, order.orderId());
        var statusSeenByProvider = new CopyOnWriteArrayList<String>();
        // The provider sees the database from its own connection: EXPIRED visible there proves the transaction had committed.
        STUB.onCancel(() -> statusSeenByProvider.add(jdbc.queryForObject("SELECT status FROM payments WHERE payment_reference=?", String.class, reference)));
        kioskJson("POST", "/api/v1/kiosk/orders/" + order.orderId() + "/cancel", order.key(), null, 200);

        assertThat(paymentStatus(order.orderId())).isEqualTo("EXPIRED");
        assertThat(STUB.cancels()).hasSize(1);
        assertThat(STUB.cancels().get(0).path()).isEqualTo("/v2/payment-requests/" + reference + "/cancel");
        assertThat(json.readTree(STUB.cancels().get(0).body()).get("cancellationReason").asText()).isEqualTo("ORDER_CANCELLED");
        assertThat(statusSeenByProvider).containsExactly("EXPIRED");
    }

    @Test
    void aRolledBackTransactionNeverCancelsTheProviderLink() throws Exception {
        var order = place("35000", 1);
        kioskJson("POST", order.payments(), order.key(), null, 201);
        transactions.executeWithoutResult(status -> {
            var entity = orderRepository.findForUpdateById(order.orderId()).orElseThrow();
            paymentService.expirePendingPayments(entity, "ORDER_CANCELLED");
            status.setRollbackOnly();
        });
        assertThat(paymentStatus(order.orderId())).isEqualTo("PENDING");
        assertThat(STUB.cancels()).isEmpty();
    }

    @Test
    void expirySweepCancelsTheProviderLinkAfterCommit() throws Exception {
        var order = place("35000", 1);
        kioskJson("POST", order.payments(), order.key(), null, 201);
        String reference = jdbc.queryForObject("SELECT payment_reference FROM payments WHERE order_id=?", String.class, order.orderId());
        clock.advance(Duration.ofMinutes(6));
        assertThat(expiry.sweep()).isEqualTo(1);
        assertThat(paymentStatus(order.orderId())).isEqualTo("EXPIRED");
        assertThat(STUB.cancels()).hasSize(1);
        assertThat(STUB.cancels().get(0).path()).contains(reference);
        assertThat(json.readTree(STUB.cancels().get(0).body()).get("cancellationReason").asText()).isEqualTo("RESERVATION_EXPIRED");
    }

    @Test
    void replacingAnExpiredAttemptCancelsTheOldLink() throws Exception {
        var order = place("35000", 1);
        kioskJson("POST", order.payments(), order.key(), null, 201);
        String first = jdbc.queryForObject("SELECT payment_reference FROM payments WHERE order_id=?", String.class, order.orderId());
        clock.advance(Duration.ofMinutes(2).plusSeconds(1));
        kioskJson("POST", order.payments(), order.key(), null, 201);
        assertThat(count("SELECT count(*) FROM payments WHERE order_id=? AND status='EXPIRED'", order.orderId())).isEqualTo(1);
        assertThat(STUB.cancels()).hasSize(1);
        assertThat(STUB.cancels().get(0).path()).contains(first);
        assertThat(json.readTree(STUB.cancels().get(0).body()).get("cancellationReason").asText()).isEqualTo("ATTEMPT_EXPIRED");
        assertThat(STUB.creates()).hasSize(2);
    }

    @Test
    void aFailingOrSlowCancelNeverChangesBackendState() throws Exception {
        var failing = place("35000", 1);
        kioskJson("POST", failing.payments(), failing.key(), null, 201);
        STUB.cancelMode(Mode.HTTP_500);
        kioskJson("POST", "/api/v1/kiosk/orders/" + failing.orderId() + "/cancel", failing.key(), null, 200);
        assertThat(paymentStatus(failing.orderId())).isEqualTo("EXPIRED");
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?", String.class, failing.orderId())).isEqualTo("CANCELLED");

        var slow = place("35000", 1);
        kioskJson("POST", slow.payments(), slow.key(), null, 201);
        STUB.cancelMode(Mode.SLOW);
        STUB.slowMillis(5000);
        long started = System.nanoTime();
        kioskJson("POST", "/api/v1/kiosk/orders/" + slow.orderId() + "/cancel", slow.key(), null, 200);
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(4));
        assertThat(paymentStatus(slow.orderId())).isEqualTo("EXPIRED");
        assertThat(count("SELECT count(*) FROM inventory_items WHERE slot_id=? AND status='RESERVED'", slow.slotId())).isZero();
    }

    @Test
    void aLinkCreatedWhileTheOrderWasBeingCancelledIsCancelledToo() throws Exception {
        var order = place("35000", 1);
        STUB.createMode(Mode.SLOW);
        STUB.slowMillis(1200);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<Integer> payment = pool.submit(() -> kioskCall("POST", order.payments(), order.key(), null).getResponse().getStatus());
            await().atMost(Duration.ofSeconds(5)).until(() -> STUB.creates().size() == 1);
            kioskJson("POST", "/api/v1/kiosk/orders/" + order.orderId() + "/cancel", order.key(), null, 200);
            assertThat(payment.get(10, TimeUnit.SECONDS)).isEqualTo(409);
        } finally {
            pool.shutdownNow();
        }
        assertThat(paymentStatus(order.orderId())).isEqualTo("EXPIRED");
        // One cancel from the order cancellation itself and one for the link payOS created right after it.
        assertThat(STUB.cancels()).hasSize(2);
        assertThat(STUB.cancels().get(0).path()).isEqualTo(STUB.cancels().get(1).path());
    }

    @Test
    void secretsAndSignaturesNeverAppearInLogsOrResponses(CapturedOutput output) throws Exception {
        List<String> responses = new ArrayList<>();
        var ok = place("35000", 1);
        responses.add(kioskJson("POST", ok.payments(), ok.key(), null, 201).toString());
        for (Mode mode : new Mode[]{Mode.HTTP_500, Mode.CODE_ERROR, Mode.GARBAGE}) {
            var failing = place("35000", 1);
            STUB.createMode(mode);
            responses.add(kioskJson("POST", failing.payments(), failing.key(), null, 502).toString());
        }
        STUB.createMode(Mode.OK);
        STUB.cancelMode(Mode.HTTP_500);
        kioskJson("POST", "/api/v1/kiosk/orders/" + ok.orderId() + "/cancel", ok.key(), null, 200);
        String all = output.getAll() + String.join("\n", responses) + fixtures.api("GET", "/api/v1/payments?size=50", null, admin.token(), 200);
        List<String> signatures = STUB.creates().stream().map(call -> {
            try {
                return json.readTree(call.body()).get("signature").asText();
            } catch (Exception ex) {
                throw new IllegalStateException(ex);
            }
        }).toList();
        assertThat(signatures).isNotEmpty().allMatch(s -> s.matches("[0-9a-f]{64}"));
        assertThat(all).doesNotContain(API_KEY, CHECKSUM, CLIENT_ID).doesNotContain(signatures);
        assertThat(output.getAll()).doesNotContain("secret-looking internal error body", "order already exists", "checkoutUrl");
    }
}
