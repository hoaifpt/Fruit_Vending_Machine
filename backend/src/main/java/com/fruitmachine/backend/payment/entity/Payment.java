package com.fruitmachine.backend.payment.entity;

import com.fruitmachine.backend.common.entity.CreatedEntity;
import com.fruitmachine.backend.order.entity.Order;
import com.fruitmachine.backend.payment.enums.PaymentStatus;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "payments")
@Getter
@Setter
@NoArgsConstructor
public class Payment extends CreatedEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "order_id", nullable = false)
    private Order order;

    @Column(name = "provider", length = 32, nullable = false)
    private String provider;

    @Column(name = "transaction_id", length = 255)
    private String transactionId;

    @Column(name = "payment_reference", length = 255)
    private String paymentReference;

    @Column(name = "amount", precision = 12, scale = 2, nullable = false)
    private BigDecimal amount;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status", length = 16, nullable = false)
    private PaymentStatus status = PaymentStatus.PENDING;

    @Column(name = "qr_code", columnDefinition = "text")
    private String qrCode;

    @Column(name = "paid_at", columnDefinition = "timestamptz")
    private Instant paidAt;

    @Column(name = "expired_at", columnDefinition = "timestamptz")
    private Instant expiredAt;
}
