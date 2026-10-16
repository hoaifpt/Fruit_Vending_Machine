package com.fruitmachine.backend.payment.payos;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.config.properties.PaymentProperties;
import com.fruitmachine.backend.payment.gateway.PaymentProviderException;
import com.fruitmachine.backend.payment.gateway.ProviderPaymentRequest;
import com.fruitmachine.backend.payment.gateway.payos.PayOsPaymentGateway;
import com.fruitmachine.backend.payment.gateway.payos.PayOsProperties;
import com.fruitmachine.backend.support.StubPayOsServer;
import com.fruitmachine.backend.support.StubPayOsServer.Mode;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import static com.fruitmachine.backend.payment.payos.PayOsSignatureTest.independentHmac;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** The real gateway and RestClient against a loopback stub; nothing here reaches the real payOS. */
@ExtendWith(OutputCaptureExtension.class)
class PayOsGatewayTest {
    static final String CLIENT_ID = "unit-client-id-77c1";
    static final String API_KEY = "unit-api-key-91ab";
    static final String CHECKSUM = "unit-checksum-key-5d2e";
    static final String RETURN_URL = "https://shop.example.invalid/return";
    static final String CANCEL_URL = "https://shop.example.invalid/cancel?from=kiosk";
    static final ObjectMapper MAPPER = new ObjectMapper();
    static StubPayOsServer stub;

    PayOsPaymentGateway gateway;

    @BeforeAll
    static void startStub() {
        stub = new StubPayOsServer();
    }

    @AfterAll
    static void stopStub() {
        stub.close();
    }

    @BeforeEach
    void setUp() {
        stub.reset();
        gateway = gateway(9, Duration.ofSeconds(1), Duration.ofSeconds(1), Clock.fixed(Instant.parse("2026-10-15T04:00:05Z"), ZoneOffset.UTC));
    }

    static PayOsPaymentGateway gateway(int descriptionMax, Duration createTimeout, Duration cancelTimeout, Clock clock) {
        var props = new PayOsProperties(stub.baseUrl(), CLIENT_ID, API_KEY, CHECKSUM, RETURN_URL, CANCEL_URL, "FV", descriptionMax, cancelTimeout);
        var payment = new PaymentProperties("PAYOS", Duration.ofMinutes(5), Duration.ofSeconds(30), 5, createTimeout);
        return new PayOsPaymentGateway(props, payment, clock, MAPPER);
    }

    static ProviderPaymentRequest request(String reference, String amount, String orderCode, Instant expiresAt) {
        return new ProviderPaymentRequest(reference, orderCode, new BigDecimal(amount), "ignored", expiresAt);
    }

    @Test
    void createSendsTheRightPathHeadersBodyAndSignature() throws Exception {
        Instant expiresAt = Instant.parse("2026-10-15T04:05:00.987654Z");
        var result = gateway.createPayment(request("261015040005123", "105000.00", "ORD-20261015-7K3QF9XA", expiresAt));
        assertThat(result.qrCode()).isEqualTo("STUB-VIETQR-PAYLOAD");
        assertThat(result.providerExpiresAt()).isEqualTo(expiresAt);

        assertThat(stub.calls()).hasSize(1);
        var call = stub.creates().get(0);
        assertThat(call.method()).isEqualTo("POST");
        assertThat(call.path()).isEqualTo("/v2/payment-requests");
        assertThat(call.header("x-client-id")).isEqualTo(CLIENT_ID);
        assertThat(call.header("x-api-key")).isEqualTo(API_KEY);
        assertThat(call.header("content-type")).startsWith("application/json");
        JsonNode body = MAPPER.readTree(call.body());
        assertThat(body.fieldNames()).toIterable().containsExactlyInAnyOrder("orderCode", "amount", "description", "returnUrl", "cancelUrl", "expiredAt", "signature");
        assertThat(body.get("orderCode").isIntegralNumber()).isTrue();
        assertThat(body.get("orderCode").asLong()).isEqualTo(261015040005123L);
        assertThat(body.get("amount").isIntegralNumber()).isTrue();
        assertThat(body.get("amount").asLong()).isEqualTo(105000L);
        assertThat(body.get("description").asText()).isEqualTo("FV7K3QF9X");
        assertThat(body.get("returnUrl").asText()).isEqualTo(RETURN_URL);
        assertThat(body.get("cancelUrl").asText()).isEqualTo(CANCEL_URL);
        // floor of the attempt deadline in epoch seconds
        assertThat(body.get("expiredAt").asLong()).isEqualTo(expiresAt.getEpochSecond());
        String expectedData = "amount=105000&cancelUrl=" + CANCEL_URL + "&description=FV7K3QF9X&orderCode=261015040005123&returnUrl=" + RETURN_URL;
        assertThat(body.get("signature").asText()).isEqualTo(independentHmac(CHECKSUM, expectedData)).matches("[0-9a-f]{64}");
    }

    @Test
    void descriptionRespectsTheMaximumLengthAndCharsetAndContainsNoCustomerData() throws Exception {
        for (int max : new int[]{9, 12, 5}) {
            stub.reset();
            var custom = gateway(max, Duration.ofSeconds(1), Duration.ofSeconds(1), Clock.systemUTC());
            custom.createPayment(request("261015040005123", "1000", "ORD-20261015-7K3QF9XA", Instant.now().plusSeconds(300)));
            String description = MAPPER.readTree(stub.creates().get(0).body()).get("description").asText();
            assertThat(description).hasSizeLessThanOrEqualTo(max).matches("[A-Za-z0-9]+").startsWith("FV");
            assertThat(description).isEqualTo(("FV7K3QF9XA").substring(0, Math.min(max, 10)));
        }
        stub.reset();
        gateway.createPayment(request("261015040005123", "1000", "ORD-2026-a_b-c d!é", Instant.now().plusSeconds(300)));
        assertThat(MAPPER.readTree(stub.creates().get(0).body()).get("description").asText()).matches("FV[A-Z0-9]*");
    }

    @Test
    void wholeVndAmountsAreSentAsIntegers() throws Exception {
        gateway.createPayment(request("261015040005123", "35000.00", "ORD-20261015-7K3QF9XA", Instant.now().plusSeconds(300)));
        gateway.createPayment(request("261015040005124", "2000", "ORD-20261015-7K3QF9XA", Instant.now().plusSeconds(300)));
        var amounts = stub.creates().stream().map(c -> readAmount(c.body())).toList();
        assertThat(amounts).containsExactly(35000L, 2000L);
        assertThat(stub.creates().get(0).body()).contains("\"amount\":35000,").doesNotContain("35000.0");
    }

    private static long readAmount(String body) {
        try {
            return MAPPER.readTree(body).get("amount").asLong();
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    @Test
    void providerFailuresBecomeSanitizedProviderExceptions() {
        for (Mode mode : new Mode[]{Mode.CODE_ERROR, Mode.HTTP_500, Mode.HTTP_401, Mode.BLANK_QR, Mode.GARBAGE}) {
            stub.reset();
            stub.createMode(mode);
            assertThatThrownBy(() -> gateway.createPayment(request("261015040005123", "5000", "ORD-20261015-7K3QF9XA", Instant.now().plusSeconds(300))))
                    .as("mode %s", mode).isInstanceOf(PaymentProviderException.class)
                    .hasMessageNotContaining(API_KEY).hasMessageNotContaining(CHECKSUM).hasMessageNotContaining(CLIENT_ID)
                    .hasMessageNotContaining("secret-looking internal error body").hasMessageNotContaining("order already exists")
                    .hasMessageNotContaining("STUB-VIETQR-PAYLOAD").hasMessageNotContaining("signature").hasNoCause();
        }
        stub.reset();
        stub.createMode(Mode.CODE_ERROR);
        assertThatThrownBy(() -> gateway.createPayment(request("261015040005123", "5000", "ORD-20261015-7K3QF9XA", Instant.now().plusSeconds(300))))
                .hasMessageContaining("231");
    }

    @Test
    void aSlowProviderTimesOutInsteadOfHanging() {
        stub.createMode(Mode.SLOW);
        stub.slowMillis(4000);
        long started = System.nanoTime();
        assertThatThrownBy(() -> gateway.createPayment(request("261015040005123", "5000", "ORD-20261015-7K3QF9XA", Instant.now().plusSeconds(300))))
                .isInstanceOf(PaymentProviderException.class).hasMessageNotContaining(API_KEY).hasNoCause();
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(3));
    }

    @Test
    void unreachableProviderIsAProviderException() {
        var props = new PayOsProperties("http://127.0.0.1:1", CLIENT_ID, API_KEY, CHECKSUM, RETURN_URL, CANCEL_URL, "FV", 9, Duration.ofSeconds(1));
        var broken = new PayOsPaymentGateway(props, new PaymentProperties("PAYOS", Duration.ofMinutes(5), Duration.ofSeconds(30), 5, Duration.ofSeconds(1)), Clock.systemUTC(), MAPPER);
        assertThatThrownBy(() -> broken.createPayment(request("261015040005123", "5000", "ORD-20261015-7K3QF9XA", Instant.now().plusSeconds(300))))
                .isInstanceOf(PaymentProviderException.class).hasMessageNotContaining(API_KEY).hasNoCause();
    }

    @Test
    void invalidInputNeverReachesTheNetwork() {
        for (String reference : new String[]{"abc", "", "-5", "0", "9007199254740992", "12.5"}) {
            assertThatThrownBy(() -> gateway.createPayment(request(reference, "5000", "ORD-1", Instant.now().plusSeconds(300))))
                    .as(reference).isInstanceOf(PaymentProviderException.class);
        }
        assertThatThrownBy(() -> gateway.createPayment(request("261015040005123", "35000.50", "ORD-1", Instant.now().plusSeconds(300)))).isInstanceOf(PaymentProviderException.class);
        assertThatThrownBy(() -> gateway.createPayment(request("261015040005123", "0", "ORD-1", Instant.now().plusSeconds(300)))).isInstanceOf(PaymentProviderException.class);
        assertThat(stub.calls()).isEmpty();
    }

    @Test
    void cancelSendsTheRightPathAndReason() throws Exception {
        for (String reason : new String[]{"ORDER_CANCELLED", "RESERVATION_EXPIRED", "ATTEMPT_EXPIRED"}) {
            stub.reset();
            gateway.cancelPayment("261015040005123", reason);
            assertThat(stub.cancels()).hasSize(1);
            var call = stub.cancels().get(0);
            assertThat(call.method()).isEqualTo("POST");
            assertThat(call.path()).isEqualTo("/v2/payment-requests/261015040005123/cancel");
            assertThat(call.header("x-client-id")).isEqualTo(CLIENT_ID);
            assertThat(call.header("x-api-key")).isEqualTo(API_KEY);
            assertThat(MAPPER.readTree(call.body()).get("cancellationReason").asText()).isEqualTo(reason);
        }
    }

    @Test
    void cancelFailuresAndTimeoutsAreSwallowedWithAWarnThatNamesOnlyTheOrderCode(CapturedOutput output) {
        stub.cancelMode(Mode.HTTP_500);
        gateway.cancelPayment("261015040005123", "ORDER_CANCELLED");
        stub.cancelMode(Mode.SLOW);
        stub.slowMillis(3000);
        long started = System.nanoTime();
        gateway.cancelPayment("261015040005124", "ORDER_CANCELLED");
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(3));
        gateway.cancelPayment("not-a-number", "ORDER_CANCELLED");
        assertThat(output.getAll()).contains("WARN").contains("261015040005123").contains("261015040005124")
                .doesNotContain(API_KEY, CHECKSUM, CLIENT_ID, "secret-looking internal error body");
    }

    @Test
    void referencesAreFifteenPositiveDigitsBelowTwoToThe53() {
        var fixed = gateway(9, Duration.ofSeconds(1), Duration.ofSeconds(1), Clock.fixed(Instant.parse("2026-10-15T04:00:05Z"), ZoneOffset.UTC));
        for (int i = 0; i < 200; i++) {
            String reference = fixed.newPaymentReference();
            assertThat(reference).hasSize(15).matches("[1-9][0-9]{14}").startsWith("261015040005");
            assertThat(Long.parseLong(reference)).isPositive().isLessThanOrEqualTo(9007199254740991L);
        }
        assertThat(gateway(9, Duration.ofSeconds(1), Duration.ofSeconds(1), Clock.systemUTC()).newPaymentReference()).hasSize(15);
    }

    @Test
    void onlyExactPositiveWholeVndAmountsWithinTheBoundAreSupported() {
        for (String ok : new String[]{"35000.00", "35000", "1", "2000.000", "3.5E+4", "2147483647"}) assertThat(gateway.supportsAmount(new BigDecimal(ok))).as(ok).isTrue();
        for (String bad : new String[]{"35000.50", "0", "0.00", "-1", "-35000", "0.01", "2147483648", "35000.0001"}) assertThat(gateway.supportsAmount(new BigDecimal(bad))).as(bad).isFalse();
        assertThat(gateway.supportsAmount(null)).isFalse();
    }
}
