package com.fruitmachine.backend.payment.repository;

import com.fruitmachine.backend.payment.entity.PaymentWebhookLog;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

public interface PaymentWebhookLogRepository extends JpaRepository<PaymentWebhookLog, UUID>, JpaSpecificationExecutor<PaymentWebhookLog> {
    /** Verified logs for provider references, newest first (index ix_payment_webhook_logs_order_time); refund payer lookup, issue #72. */
    List<PaymentWebhookLog> findByVerifiedTrueAndOrderCodeInOrderByReceivedAtDescIdDesc(Collection<String> orderCodes);
}
