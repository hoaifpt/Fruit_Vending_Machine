package com.fruitmachine.backend.persistence.entity;

import com.fruitmachine.backend.persistence.enums.OrderStatus;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "orders", uniqueConstraints = @UniqueConstraint(columnNames = {"id", "machine_id"}))
@Getter
@Setter
@NoArgsConstructor
public class Order extends CreatedEntity {
    @Column(name = "order_code", length = 64, nullable = false, unique = true)
    private String orderCode;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "machine_id", nullable = false)
    private Machine machine;

    @Column(name = "machine_id", nullable = false, insertable = false, updatable = false)
    @Setter(AccessLevel.NONE)
    private UUID machineId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status", length = 24, nullable = false)
    private OrderStatus status = OrderStatus.PENDING_PAYMENT;

    @Column(name = "subtotal", precision = 12, scale = 2, nullable = false)
    private BigDecimal subtotal;

    @Column(name = "total_amount", precision = 12, scale = 2, nullable = false)
    private BigDecimal totalAmount;

    @Column(name = "paid_at", columnDefinition = "timestamptz")
    private Instant paidAt;

    @Column(name = "completed_at", columnDefinition = "timestamptz")
    private Instant completedAt;

    @Column(name = "cancelled_at", columnDefinition = "timestamptz")
    private Instant cancelledAt;

    @OneToMany(mappedBy = "order", fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    private Set<OrderItem> items = new HashSet<>();

    @OneToMany(mappedBy = "order", fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    private Set<Payment> payments = new HashSet<>();
}
