package com.fruitmachine.backend.persistence.entity;

import com.fruitmachine.backend.persistence.enums.AllocationStatus;
import jakarta.persistence.*;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "order_item_allocations")
@Getter
@Setter
@NoArgsConstructor
public class OrderItemAllocation extends UpdatedEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "order_item_id", nullable = false)
    private OrderItem orderItem;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "inventory_item_id", nullable = false)
    private InventoryItem inventoryItem;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status", length = 16, nullable = false)
    private AllocationStatus status = AllocationStatus.RESERVED;

    @Column(name = "released_at", columnDefinition = "timestamptz")
    private Instant releasedAt;
}
