package com.fruitmachine.backend.payment.refund.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.payment.entity.Payment;
import com.fruitmachine.backend.payment.entity.PaymentWebhookLog;
import com.fruitmachine.backend.payment.refund.dto.PayerAccountResponse;
import com.fruitmachine.backend.payment.repository.PaymentWebhookLogRepository;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * The payer's bank account as the provider reported it in a VERIFIED webhook of the payment (payOS sends counterAccountName,
 * counterAccountNumber, counterAccountBankId, counterAccountBankName in {@code data}). Unverified logs are never used. One indexed
 * query per page; the values are returned to REFUND_READ holders only and never logged.
 */
@Component
@RequiredArgsConstructor
public class PayerAccountResolver {
    private final PaymentWebhookLogRepository logs;

    public Map<UUID, PayerAccountResponse> resolve(List<Payment> payments) {
        List<String> references = payments.stream().map(Payment::getPaymentReference).filter(Objects::nonNull).distinct().toList();
        Map<UUID, PayerAccountResponse> result = new HashMap<>();
        if (references.isEmpty()) return result;
        List<PaymentWebhookLog> verified = logs.findByVerifiedTrueAndOrderCodeInOrderByReceivedAtDescIdDesc(references);
        for (Payment payment : payments) {
            if (payment.getPaymentReference() == null) continue;
            verified.stream()
                    .filter(log -> payment.getPaymentReference().equals(log.getOrderCode()) && payment.getProvider().equals(log.getProvider()))
                    .map(log -> payer(log.getRawPayload())).filter(Objects::nonNull).findFirst()
                    .ifPresent(payer -> result.put(payment.getId(), payer));
        }
        return result;
    }

    static PayerAccountResponse payer(JsonNode payload) {
        if (payload == null || !payload.isObject()) return null;
        JsonNode data = payload.get("data");
        JsonNode source = data != null && data.isObject() ? data : payload;
        String name = text(source, "counterAccountName");
        String number = text(source, "counterAccountNumber");
        String bankId = text(source, "counterAccountBankId");
        String bankName = text(source, "counterAccountBankName");
        if (name == null && number == null && bankId == null && bankName == null) return null;
        return new PayerAccountResponse(name, number, bankId, bankName);
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.isValueNode() || value.isNull()) return null;
        String text = value.asText().strip();
        return text.isEmpty() || text.length() > 255 ? null : text;
    }
}
