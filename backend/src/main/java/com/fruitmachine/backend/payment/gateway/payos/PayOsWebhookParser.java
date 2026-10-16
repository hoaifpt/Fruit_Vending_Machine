package com.fruitmachine.backend.payment.gateway.payos;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import org.springframework.stereotype.Component;

/** Extracts the facts the payment layer needs from an already verified payOS webhook body. */
@Component
public class PayOsWebhookParser {
    private static final ZoneId VIETNAM = ZoneId.of("Asia/Ho_Chi_Minh");
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final String SUCCESS_CODE = "00";

    public PayOsWebhookEvent parse(String rawBody) {
        JsonNode root;
        try {
            root = PayOsWebhookVerifier.RAW.readTree(rawBody);
        } catch (Exception ex) {
            throw new PayOsWebhookException("Webhook body is not valid JSON");
        }
        if (root == null || !root.isObject() || !root.path("data").isObject()) throw new PayOsWebhookException("Webhook body has no data object");
        JsonNode data = root.get("data");
        boolean success = SUCCESS_CODE.equals(text(root, "code")) && SUCCESS_CODE.equals(text(data, "code"));
        JsonNode orderCode = data.get("orderCode");
        JsonNode amount = data.get("amount");
        if (orderCode == null || !orderCode.isIntegralNumber() || orderCode.asLong() <= 0) throw new PayOsWebhookException("Webhook orderCode is missing or invalid");
        if (amount == null || !amount.isIntegralNumber() || amount.asLong() < 0) throw new PayOsWebhookException("Webhook amount is missing or invalid");
        return new PayOsWebhookEvent(success, orderCode.bigIntegerValue().toString(), text(data, "reference"),
                BigDecimal.valueOf(amount.asLong()).setScale(2), parseTime(text(data, "transactionDateTime")), text(data, "paymentLinkId"));
    }

    private static Instant parseTime(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return LocalDateTime.parse(value.strip(), TIME).atZone(VIETNAM).toInstant();
        } catch (DateTimeParseException ex) {
            throw new PayOsWebhookException("Webhook transactionDateTime is invalid");
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }
}
