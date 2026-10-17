package com.fruitmachine.backend.payment.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.audit.entity.AuditLog;
import com.fruitmachine.backend.audit.repository.AuditLogRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Durable, queryable record of payment anomalies that need a human (for example a refund). One audit_logs row per anomaly,
 * user_id NULL (system). Anomalies are never auto-resolved. The application log carries only ids and the anomaly type.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PaymentAnomalyRecorder {
    public static final String LATE = "PAYMENT_LATE";
    public static final String DUPLICATE = "PAYMENT_DUPLICATE";
    public static final String AMOUNT_MISMATCH = "PAYMENT_AMOUNT_MISMATCH";
    public static final String TRANSACTION_CONFLICT = "PAYMENT_TRANSACTION_CONFLICT";

    private final AuditLogRepository audit;

    /** Joins the caller's transaction, so the anomaly commits or rolls back together with the state it describes. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void record(String action, UUID paymentId, JsonNode oldValue, JsonNode newValue) {
        save(action, paymentId, oldValue, newValue);
    }

    /** Own transaction, for anomalies whose business transaction was rolled back. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordIndependently(String action, UUID paymentId, JsonNode oldValue, JsonNode newValue) {
        save(action, paymentId, oldValue, newValue);
    }

    private void save(String action, UUID paymentId, JsonNode oldValue, JsonNode newValue) {
        var row = new AuditLog();
        row.setAction(action);
        row.setEntityType("Payment");
        row.setEntityId(paymentId);
        row.setOldValue(oldValue);
        row.setNewValue(newValue);
        audit.save(row);
        log.warn("Payment anomaly {} recorded for payment {}", action, paymentId);
    }
}
