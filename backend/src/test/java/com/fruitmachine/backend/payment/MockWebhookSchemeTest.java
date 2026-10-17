package com.fruitmachine.backend.payment;

import com.fruitmachine.backend.payment.gateway.HmacSha256;
import com.fruitmachine.backend.payment.gateway.VerifiedPaymentEvent;
import com.fruitmachine.backend.payment.gateway.mock.MockPaymentGateway;
import com.fruitmachine.backend.payment.gateway.mock.MockPaymentProperties;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import static org.assertj.core.api.Assertions.assertThat;

/** The MOCK webhook scheme: X-Mock-Signature is the hex HMAC-SHA256 of the exact raw body under the configured secret. */
class MockWebhookSchemeTest {
    private static final String SECRET = "unit-mock-secret";
    private final MockPaymentGateway gateway = new MockPaymentGateway(new MockPaymentProperties(SECRET));

    private static HttpHeaders signed(String body) {
        var headers = new HttpHeaders();
        headers.set("X-Mock-Signature", HmacSha256.hex(SECRET, body));
        return headers;
    }

    private static final String SUCCESS = "{\"paymentReference\":\"MOCK-8F3KQ2\",\"transactionId\":\"MOCK-TXN-0001\",\"amount\":105000.00,\"status\":\"SUCCESS\"}";

    @Test
    void aCorrectlySignedSuccessBodyYieldsAVerifiedSuccessEvent() {
        var result = gateway.verifyWebhook(SUCCESS, signed(SUCCESS));
        assertThat(result.verified()).isTrue();
        assertThat(result.eventType()).isEqualTo("PAYMENT_SUCCESS");
        assertThat(result.referenceHint()).isEqualTo("MOCK-8F3KQ2");
        assertThat(result.signature()).isEqualTo(HmacSha256.hex(SECRET, SUCCESS));
        assertThat(result.event().type()).isEqualTo(VerifiedPaymentEvent.Type.SUCCESS);
        assertThat(result.event().paymentReference()).isEqualTo("MOCK-8F3KQ2");
        assertThat(result.event().transactionId()).isEqualTo("MOCK-TXN-0001");
        assertThat(result.event().amount()).isEqualByComparingTo(new BigDecimal("105000.00"));
        assertThat(gateway.webhookAcknowledgement()).isEqualTo(java.util.Map.of("success", true));
    }

    @Test
    void aBlankSecretNeverVerifiesEvenWithAnApparentlyCorrectSignature() {
        for (String secret : new String[]{"", "   "}) {
            var blank = new MockPaymentGateway(new MockPaymentProperties(secret));
            var headers = new HttpHeaders();
            headers.set("X-Mock-Signature", HmacSha256.hex("k", SUCCESS));
            assertThat(blank.verifyWebhook(SUCCESS, headers).verified()).isFalse();
            headers.set("X-Mock-Signature", HmacSha256.hex(secret.isBlank() ? "x" : secret, SUCCESS));
            assertThat(blank.verifyWebhook(SUCCESS, headers).verified()).isFalse();
        }
        assertThat(new MockPaymentGateway(new MockPaymentProperties(null)).verifyWebhook(SUCCESS, signed(SUCCESS)).verified()).isFalse();
    }

    @Test
    void tamperedMissingOrWrongSignaturesAndMalformedBodiesAreRejected() {
        var other = new MockPaymentGateway(new MockPaymentProperties("another-secret"));
        assertThat(other.verifyWebhook(SUCCESS, signed(SUCCESS)).verified()).isFalse();
        assertThat(gateway.verifyWebhook(SUCCESS + " ", signed(SUCCESS)).verified()).isFalse();
        assertThat(gateway.verifyWebhook(SUCCESS, new HttpHeaders()).verified()).isFalse();
        assertThat(gateway.verifyWebhook(SUCCESS, null).verified()).isFalse();
        assertThat(gateway.verifyWebhook(null, signed(SUCCESS)).verified()).isFalse();
        for (String body : new String[]{"", "not json", "[]", "\"x\"", "{"}) {
            var result = gateway.verifyWebhook(body, signed(body));
            assertThat(result.verified()).as(body).isFalse();
            assertThat(result.event()).isNull();
        }
        // The untrusted hint is still extracted for the evidence log.
        assertThat(gateway.verifyWebhook(SUCCESS, new HttpHeaders()).referenceHint()).isEqualTo("MOCK-8F3KQ2");
    }

    @Test
    void failedAndUnknownStatusesAndIncompleteSuccessBodiesAreMappedSafely() {
        String failed = "{\"paymentReference\":\"R1\",\"status\":\"FAILED\"}";
        var failure = gateway.verifyWebhook(failed, signed(failed));
        assertThat(failure.verified()).isTrue();
        assertThat(failure.eventType()).isEqualTo("PAYMENT_FAILED");
        assertThat(failure.event().type()).isEqualTo(VerifiedPaymentEvent.Type.FAILED);
        for (String body : new String[]{"{\"paymentReference\":\"R1\",\"status\":\"PENDING\"}", "{\"paymentReference\":\"R1\",\"status\":\"success\"}",
                "{\"status\":\"SUCCESS\",\"transactionId\":\"T\",\"amount\":1}", "{\"paymentReference\":\"R1\",\"status\":\"SUCCESS\",\"amount\":1}",
                "{\"paymentReference\":\"R1\",\"status\":\"SUCCESS\",\"transactionId\":\"T\"}", "{\"paymentReference\":\"R1\",\"status\":\"SUCCESS\",\"transactionId\":\"T\",\"amount\":\"1\"}",
                "{\"paymentReference\":\"R1\",\"status\":\"SUCCESS\",\"transactionId\":\" \",\"amount\":1}"}) {
            var result = gateway.verifyWebhook(body, signed(body));
            assertThat(result.verified()).as(body).isTrue();
            assertThat(result.event()).as(body).isNull();
        }
    }

    @Test
    void theAmountKeepsItsExactDecimalValue() {
        String body = "{\"paymentReference\":\"R1\",\"transactionId\":\"T\",\"amount\":12345.60,\"status\":\"SUCCESS\"}";
        assertThat(gateway.verifyWebhook(body, signed(body)).event().amount()).isEqualTo(new BigDecimal("12345.60"));
    }

    @Test
    void propertiesNeverPrintTheSecret() {
        assertThat(new MockPaymentProperties(SECRET).toString()).doesNotContain(SECRET).contains("***");
        assertThat(new MockPaymentProperties("").toString()).contains("<unset>");
    }
}
