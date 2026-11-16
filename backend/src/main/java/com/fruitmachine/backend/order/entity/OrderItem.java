package com.fruitmachine.backend.order.entity;

import com.fruitmachine.backend.pricing.enums.DiscountReason;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import com.fruitmachine.backend.common.entity.CreatedEntity;
import com.fruitmachine.backend.product.entity.Product;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.util.HashSet;
import java.util.Set;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "order_items")
@Getter
@Setter
@NoArgsConstructor
public class OrderItem extends CreatedEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "order_id", nullable = false)
    private Order order;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "product_id", nullable = false)
    private Product product;

    @Column(name = "quantity", nullable = false)
    private Integer quantity;

    /** Product price when the bowl was reserved (issue #61). */
    @Column(name = "original_unit_price", precision = 12, scale = 2, nullable = false)
    private BigDecimal originalUnitPrice;

    /** Price charged for one bowl (unchanged meaning: price paid). */
    @Column(name = "unit_price", precision = 12, scale = 2, nullable = false)
    private BigDecimal unitPrice;

    @Column(name = "discount_percent", nullable = false)
    private Short discountPercent = 0;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "discount_reason", length = 24, nullable = false)
    private DiscountReason discountReason = DiscountReason.NONE;

    @Column(name = "total_price", precision = 12, scale = 2, nullable = false)
    private BigDecimal totalPrice;

    @OneToMany(mappedBy = "orderItem", fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    private Set<OrderItemAllocation> allocations = new HashSet<>();
}
