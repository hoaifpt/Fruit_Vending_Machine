package com.fruitmachine.backend.payment.gateway.payos;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.payment.gateway.HmacSha256;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import java.util.TreeMap;

/** Pure HMAC-SHA256 helpers for payOS: create-request signature and webhook data canonicalization. */
public final class PayOsSignature {
    private PayOsSignature() {
    }

    /** Lowercase hex HMAC-SHA256 of data under the checksum key (UTF-8). */
    public static String hmacSha256Hex(String key, String data) {
        return HmacSha256.hex(key, data);
    }

    /** Keys in alphabetical order with raw (not URL-encoded) values, joined by &. */
    public static String createDataString(long amount, String cancelUrl, String description, long orderCode, String returnUrl) {
        return "amount=" + amount + "&cancelUrl=" + cancelUrl + "&description=" + description + "&orderCode=" + orderCode
                + "&returnUrl=" + returnUrl;
    }

    public static String createSignature(String checksumKey, long amount, String cancelUrl, String description, long orderCode,
            String returnUrl) {
        return hmacSha256Hex(checksumKey, createDataString(amount, cancelUrl, description, orderCode, returnUrl));
    }

    /**
     * Webhook canonical form of the data object: keys sorted alphabetically, key=value joined by &. null/missing/"null"/"undefined"
     * become an empty string, numbers are plain decimal text, strings are used as received and objects/arrays become compact JSON
     * with sorted object keys. Callers must pass the node parsed from the raw body (exact numbers), never a re-serialized object.
     */
    public static String canonicalize(JsonNode data) {
        var sorted = new TreeMap<String, JsonNode>();
        data.fields().forEachRemaining(entry -> sorted.put(entry.getKey(), entry.getValue()));
        var builder = new StringBuilder();
        for (Map.Entry<String, JsonNode> entry : sorted.entrySet()) {
            if (builder.length() > 0) builder.append('&');
            builder.append(entry.getKey()).append('=').append(valueText(entry.getValue()));
        }
        return builder.toString();
    }

    private static String valueText(JsonNode value) {
        if (value == null || value.isNull() || value.isMissingNode()) return "";
        if (value.isTextual()) {
            String text = value.asText();
            return text.equals("null") || text.equals("undefined") ? "" : text;
        }
        if (value.isIntegralNumber()) return value.bigIntegerValue().toString();
        if (value.isNumber()) return value.decimalValue().toPlainString();
        if (value.isBoolean()) return Boolean.toString(value.booleanValue());
        return sortedCopy(value).toString();
    }

    private static JsonNode sortedCopy(JsonNode node) {
        if (node.isObject()) {
            ObjectNode copy = JsonNodeFactory.instance.objectNode();
            var sorted = new TreeMap<String, JsonNode>();
            node.fields().forEachRemaining(entry -> sorted.put(entry.getKey(), entry.getValue()));
            sorted.forEach((key, child) -> copy.set(key, sortedCopy(child)));
            return copy;
        }
        if (node.isArray()) {
            ArrayNode copy = JsonNodeFactory.instance.arrayNode();
            node.forEach(child -> copy.add(sortedCopy(child)));
            return copy;
        }
        return node;
    }

    /** Constant-time comparison of two hex signatures (case-insensitive). */
    public static boolean constantTimeEquals(String expected, String actual) {
        return HmacSha256.constantTimeEquals(expected, actual);
    }
}
