package com.fruitmachine.backend.payment.payos;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.payment.gateway.payos.PayOsSignature;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class PayOsSignatureTest {
    private static final ObjectMapper RAW = new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
            .setNodeFactory(com.fasterxml.jackson.databind.node.JsonNodeFactory.withExactBigDecimals(true));

    @Test
    void hmacMatchesTheRfc4231TestVectorsAndIsLowercaseHex() {
        // RFC 4231 test case 1: 20 bytes of 0x0b, "Hi There".
        assertThat(PayOsSignature.hmacSha256Hex("\u000b".repeat(20), "Hi There"))
                .isEqualTo("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
        // RFC 4231 test case 2: key "Jefe".
        String two = PayOsSignature.hmacSha256Hex("Jefe", "what do ya want for nothing?");
        assertThat(two).isEqualTo("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843").matches("[0-9a-f]{64}");
    }

    @Test
    void createDataStringHasAlphabeticalKeysAndRawValues() {
        // Raw values: no URL encoding, query strings and special characters stay untouched.
        String data = PayOsSignature.createDataString(105000, "https://shop.example/cancel?a=1&b=2", "FV7K3QF9X", 261015040005123L, "https://shop.example/return");
        assertThat(data).isEqualTo("amount=105000&cancelUrl=https://shop.example/cancel?a=1&b=2&description=FV7K3QF9X&orderCode=261015040005123&returnUrl=https://shop.example/return");
        assertThat(PayOsSignature.createSignature("checksum", 105000, "https://shop.example/cancel?a=1&b=2", "FV7K3QF9X", 261015040005123L, "https://shop.example/return"))
                .isEqualTo(independentHmac("checksum", data));
    }

    @Test
    void canonicalizationSortsKeysAndAppliesTheDocumentedValueRules() throws Exception {
        String data = """
                {"zeta":"last","orderCode":123,"amount":3000,"nothing":null,"literalNull":"null","literalUndefined":"undefined","empty":"",
                 "flag":true,"price":12.50,"big":123456789012345678901234567890,"list":[{"b":2,"a":1},3],"obj":{"y":1,"x":[true,null]},"text":"Th\\u00e0nh c\\u00f4ng"}""";
        assertThat(PayOsSignature.canonicalize(RAW.readTree(data))).isEqualTo(
                "amount=3000&big=123456789012345678901234567890&empty=&flag=true&list=[{\"a\":1,\"b\":2},3]&literalNull=&literalUndefined="
                        + "&nothing=&obj={\"x\":[true,null],\"y\":1}&orderCode=123&price=12.50&text=Thành công&zeta=last");
    }

    @Test
    void sampleWebhookDataCanonicalizesToTheExpectedString() throws Exception {
        assertThat(PayOsSignature.canonicalize(RAW.readTree(SAMPLE_DATA))).isEqualTo(SAMPLE_CANONICAL);
    }

    @Test
    void comparisonIsExactForEqualHexAndRejectsEverythingElse() {
        String signature = independentHmac("key", "data");
        assertThat(PayOsSignature.constantTimeEquals(signature, signature)).isTrue();
        assertThat(PayOsSignature.constantTimeEquals(signature, signature.toUpperCase())).isTrue();
        assertThat(PayOsSignature.constantTimeEquals(signature, signature.substring(1))).isFalse();
        assertThat(PayOsSignature.constantTimeEquals(signature, "0".repeat(64))).isFalse();
        assertThat(PayOsSignature.constantTimeEquals(signature, null)).isFalse();
        assertThat(PayOsSignature.constantTimeEquals(null, signature)).isFalse();
    }

    @Test
    void comparisonUsesTheConstantTimeJdkPrimitiveInsteadOfStringEquality() throws Exception {
        // The source is part of the contract here: String.equals leaks the position of the first mismatch.
        String source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/java/com/fruitmachine/backend/payment/gateway/payos/PayOsSignature.java"));
        assertThat(source).contains("MessageDigest.isEqual");
        assertThat(source).doesNotContain(".equals(signature").doesNotContain("expected.equals(");
    }

    static final String SAMPLE_DATA = """
            {"orderCode":123,"amount":3000,"description":"VQRIO123","accountNumber":"12345678","reference":"TF230204212323",
             "transactionDateTime":"2023-02-04 18:25:00","currency":"VND","paymentLinkId":"124c33293c43417ab7879e14c8d9eb18","code":"00",
             "desc":"Th\\u00e0nh c\\u00f4ng","counterAccountBankId":"","counterAccountBankName":"","counterAccountName":"",
             "counterAccountNumber":"","virtualAccountName":"","virtualAccountNumber":""}""";
    static final String SAMPLE_CANONICAL = "accountNumber=12345678&amount=3000&code=00&counterAccountBankId=&counterAccountBankName="
            + "&counterAccountName=&counterAccountNumber=&currency=VND&desc=Thành công&description=VQRIO123&orderCode=123"
            + "&paymentLinkId=124c33293c43417ab7879e14c8d9eb18&reference=TF230204212323&transactionDateTime=2023-02-04 18:25:00"
            + "&virtualAccountName=&virtualAccountNumber=";

    /** HMAC computed straight with javax.crypto so the helper under test is not checked against itself. */
    static String independentHmac(String key, String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}
