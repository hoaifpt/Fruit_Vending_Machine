package com.fruitmachine.backend.payment.repository;

import com.fruitmachine.backend.payment.entity.PaymentWebhookLog;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

public interface PaymentWebhookLogRepository extends JpaRepository<PaymentWebhookLog, UUID>, JpaSpecificationExecutor<PaymentWebhookLog> {
}
