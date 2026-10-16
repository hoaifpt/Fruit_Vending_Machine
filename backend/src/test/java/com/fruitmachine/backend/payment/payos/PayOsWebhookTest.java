package com.fruitmachine.backend.payment.payos;

import com.fruitmachine.backend.payment.gateway.payos.PayOsProperties;
import com.fruitmachine.backend.payment.gateway.payos.PayOsWebhookEvent;
import com.fruitmachine.backend.payment.gateway.payos.PayOsWebhookException;
import com.fruitmachine.backend.payment.gateway.payos.PayOsWebhookParser;
import com.fruitmachine.backend.payment.gateway.payos.PayOsWebhookVerifier;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import static com.fruitmachine.backend.payment.payos.PayOsSignatureTest.SAMPLE_CANONICAL;
import static com.fruitmachine.backend.payment.payos.PayOsSignatureTest.SAMPLE_DATA;
import static com.fruitmachine.backend.payment.payos.PayOsSignatureTest.independentHmac;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PayOsWebhookTest {
    private static final String KEY = "unit-test-checksum-key";

    private final PayOsWebhookVerifier verifier = new PayOsWebhookVerifier(properties(KEY));
    private final PayOsWebhookParser parser = new PayOsWebhookParser();

    private static PayOsProperties properties(String checksumKey) {
        return new PayOsProperties("http://127.0.0.1:1", "id", "key", checksumKey, "http://127.0.0.1/r", "http://127.0.0.1/c", "FV", 9, Duration.ofSeconds(1));
    }

    private static String webhook(String dataJson, String signature) {
        return "{\"code\":\"00\",\"desc\":\"success\",\"success\":true,\"data\":" + dataJson + ",\"signature\":\"" + signature + "\"}";
    }

    private static String signed(String dataJson, String canonical) {
        return webhook(dataJson, independentHmac(KEY, canonical));
    }

    private String sample() {
        return signed(SAMPLE_DATA, SAMPLE_CANONICAL);
    }

    @Test
    void acceptsACorrectlySignedPayloadEvenWithUppercaseSignature() {
        assertThat(verifier.verify(sample())).isTrue();
        assertThat(verifier.verify(webhook(SAMPLE_DATA, independentHmac(KEY, SAMPLE_CANONICAL).toUpperCase()))).isTrue();
    }

    @Test
    void rejectsAnyAlteredField() {
        String good = sample();
        for (String[] change : new String[][]{{"\"amount\":3000", "\"amount\":3001"}, {"\"orderCode\":123", "\"orderCode\":124"},
                {"\"reference\":\"TF230204212323\"", "\"reference\":\"TF230204212324\""}, {"\"currency\":\"VND\"", "\"currency\":\"USD\""},
                {"\"description\":\"VQRIO123\"", "\"description\":\"VQRIO124\""}}) {
            assertThat(good).contains(change[0]);
            assertThat(verifier.verify(good.replace(change[0], change[1]))).as(change[1]).isFalse();
        }
        assertThat(verifier.verify(good.replace("\"signature\":\"", "\"signature\":\"0"))).isFalse();
    }

    @Test
    void rejectsAWrongOrMissingChecksumKey() {
        assertThat(new PayOsWebhookVerifier(properties("another-key")).verify(sample())).isFalse();
        assertThat(new PayOsWebhookVerifier(properties("")).verify(sample())).isFalse();
        assertThat(new PayOsWebhookVerifier(properties("  ")).verify(sample())).isFalse();
    }

    @Test
    void usesTheDocumentedNullAndEmptyCanonicalization() {
        String data = "{\"orderCode\":7,\"amount\":2000,\"reference\":null,\"description\":\"\",\"desc\":\"null\",\"code\":\"00\"}";
        String canonical = "amount=2000&code=00&desc=&description=&orderCode=7&reference=";
        assertThat(verifier.verify(signed(data, canonical))).isTrue();
        // A key that is simply absent is canonicalized by omission, so it must not verify against the null form.
        assertThat(verifier.verify(signed("{\"orderCode\":7,\"amount\":2000,\"description\":\"\",\"desc\":\"null\",\"code\":\"00\"}", canonical))).isFalse();
    }

    @Test
    void malformedInputFailsVerificationWithoutLeakingExceptions() {
        for (String body : new String[]{null, "", "   ", "not json", "{", "[]", "\"text\"", "{}", "{\"signature\":\"abc\"}", "{\"data\":{\"a\":1}}",
                "{\"data\":[],\"signature\":\"abc\"}", "{\"data\":{\"a\":1},\"signature\":null}", "{\"data\":{\"a\":1},\"signature\":\"\"}",
                "{\"data\":{\"a\":1},\"signature\":123}", "{\"data\":\"x\",\"signature\":\"abc\"}"}) {
            assertThat(verifier.verify(body)).as("%s", body).isFalse();
        }
    }

    @Test
    void parsesAVerifiedSuccessfulWebhook() {
        PayOsWebhookEvent event = parser.parse(sample());
        assertThat(event.success()).isTrue();
        assertThat(event.paymentReference()).isEqualTo("123");
        assertThat(event.transactionId()).isEqualTo("TF230204212323");
        assertThat(event.amount()).isEqualTo(new BigDecimal("3000.00")).hasScaleOf(2);
        assertThat(event.paymentLinkId()).isEqualTo("124c33293c43417ab7879e14c8d9eb18");
        // 18:25:00 Asia/Ho_Chi_Minh (UTC+7) is 11:25:00 UTC.
        assertThat(event.transactionTime()).isEqualTo(Instant.parse("2023-02-04T11:25:00Z"));
    }

    @Test
    void keepsAFifteenDigitOrderCodeExactAsDecimalText() {
        String body = webhook("{\"orderCode\":261015040005123,\"amount\":105000,\"reference\":\"FT1\",\"transactionDateTime\":\"2026-10-15 11:02:13\",\"code\":\"00\"}", "x");
        var event = parser.parse(body);
        assertThat(event.paymentReference()).isEqualTo("261015040005123");
        assertThat(event.amount()).isEqualByComparingTo("105000");
        assertThat(event.transactionTime()).isEqualTo(Instant.parse("2026-10-15T04:02:13Z"));
    }

    @Test
    void successRequiresBothTheTopLevelAndTheDataCodeToBeZeroZero() {
        String data = "\"orderCode\":5,\"amount\":1000,\"reference\":\"R\",\"transactionDateTime\":\"2026-01-01 00:00:00\"";
        assertThat(parser.parse("{\"code\":\"00\",\"data\":{" + data + ",\"code\":\"00\"}}").success()).isTrue();
        assertThat(parser.parse("{\"code\":\"00\",\"data\":{" + data + ",\"code\":\"01\"}}").success()).isFalse();
        assertThat(parser.parse("{\"code\":\"99\",\"data\":{" + data + ",\"code\":\"00\"}}").success()).isFalse();
        assertThat(parser.parse("{\"code\":\"00\",\"success\":true,\"data\":{" + data + "}}").success()).isFalse();
        assertThat(parser.parse("{\"data\":{" + data + ",\"code\":\"00\"}}").success()).isFalse();
    }

    @Test
    void malformedWebhookBodiesFailWithASafeDomainExceptionNotRawParserErrors() {
        String secret = "super-secret-body-content";
        for (String body : new String[]{"not json " + secret, "{", "[]", "{\"code\":\"00\"}", "{\"data\":{\"amount\":1}}",
                "{\"data\":{\"orderCode\":1}}", "{\"data\":{\"orderCode\":\"abc\",\"amount\":1}}", "{\"data\":{\"orderCode\":1.5,\"amount\":1}}",
                "{\"data\":{\"orderCode\":0,\"amount\":1}}", "{\"data\":{\"orderCode\":1,\"amount\":-5}}",
                "{\"data\":{\"orderCode\":1,\"amount\":1,\"transactionDateTime\":\"yesterday " + secret + "\"}}"}) {
            assertThatThrownBy(() -> parser.parse(body)).as("%s", body).isInstanceOf(PayOsWebhookException.class)
                    .hasMessageNotContaining(secret).hasMessageNotContaining("{");
        }
    }
}
