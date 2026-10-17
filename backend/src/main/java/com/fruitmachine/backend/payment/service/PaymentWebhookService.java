package com.fruitmachine.backend.payment.service;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.payment.gateway.PaymentGateway;
import com.fruitmachine.backend.payment.gateway.PaymentGatewayRegistry;
import java.util.Locale;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Service;

/**
 * Orchestrates one webhook: verify, persist the attempt in its own transaction, then (only if verified) process it.
 * Deliberately not transactional itself so the log row commits independently of the business transaction.
 */
@Service
@RequiredArgsConstructor
public class PaymentWebhookService {
    /** Result of handling a webhook. The controller maps it to an HTTP response; the acknowledgement is provider specific. */
    public record Result(boolean accepted, Object acknowledgement) {
    }

    private final PaymentGatewayRegistry gateways;
    private final PaymentWebhookLogWriter logWriter;
    private final PaymentConfirmationService confirmation;
    private final PaymentAnomalyRecorder anomalies;

    /** The path provider must be the single active gateway; anything else is unknown (404). */
    public PaymentGateway requireActive(String providerPath) {
        var gateway = gateways.active();
        if (providerPath == null || !gateway.provider().equals(providerPath.strip().toUpperCase(Locale.ROOT))) {
            throw new ResourceNotFoundException("Payment provider not found");
        }
        return gateway;
    }

    public Result handle(PaymentGateway gateway, String rawBody, HttpHeaders headers) {
        String provider = gateway.provider();
        var verification = gateway.verifyWebhook(rawBody, headers);
        // Evidence first, in its own transaction: business processing may roll back, the record of what arrived must not.
        logWriter.record(provider, rawBody, verification);
        if (!verification.verified()) return new Result(false, null);
        if (verification.event() != null) {
            try {
                confirmation.process(provider, verification.event());
            } catch (TransactionConflictException ex) {
                // The business transaction rolled back; the anomaly is written in a new transaction.
                var factory = JsonNodeFactory.instance;
                anomalies.recordIndependently(PaymentAnomalyRecorder.TRANSACTION_CONFLICT, ex.paymentId(),
                        factory.objectNode().put("paymentStatus", ex.paymentStatus()).put("orderStatus", ex.orderStatus()),
                        factory.objectNode().put("paymentStatus", ex.paymentStatus()).put("orderStatus", ex.orderStatus())
                                .put("transactionId", verification.event().transactionId()));
            }
        }
        return new Result(true, gateway.webhookAcknowledgement());
    }
}
