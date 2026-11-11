package com.fruitmachine.backend.persistence.entity;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.*;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.Generated;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.generator.EventType;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "payment_webhook_logs")
@Getter
@Setter
@NoArgsConstructor
public class PaymentWebhookLog extends UuidEntity {
    @Column(name = "provider", length = 32, nullable = false)
    private String provider;

    @Column(name = "event_type", length = 100)
    private String eventType;

    @Column(name = "order_code", length = 64)
    private String orderCode;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "raw_payload", columnDefinition = "jsonb")
    private JsonNode rawPayload;

    @Column(name = "raw_body", columnDefinition = "text", nullable = false)
    private String rawBody;

    @Column(name = "signature", columnDefinition = "text")
    private String signature;

    @Column(name = "is_verified", nullable = false)
    private boolean verified;

    @Generated(event = EventType.INSERT)
    @Column(name = "received_at", nullable = false, insertable = false, updatable = false,
            columnDefinition = "timestamptz")
    @Setter(AccessLevel.NONE)
    private Instant receivedAt;
}
