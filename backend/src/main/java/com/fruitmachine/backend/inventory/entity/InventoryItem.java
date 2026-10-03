package com.fruitmachine.backend.inventory.entity;

import com.fruitmachine.backend.inventory.enums.InventoryStatus;
import com.fruitmachine.backend.machine.entity.MachineSlot;
import com.fruitmachine.backend.order.entity.OrderItemAllocation;
import com.fruitmachine.backend.product.entity.ProductBatch;
import com.fruitmachine.backend.common.entity.UpdatedEntity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import java.util.HashSet;
import java.util.Set;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "inventory_items", uniqueConstraints = @UniqueConstraint(columnNames = {"id", "slot_id"}))
@Getter
@Setter
@NoArgsConstructor
public class InventoryItem extends UpdatedEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "batch_id", nullable = false)
    private ProductBatch batch;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "slot_id")
    private MachineSlot slot;

    // Exposes the non-PK column used by the dispense command composite FK.
    @Column(name = "slot_id", insertable = false, updatable = false)
    @Setter(AccessLevel.NONE)
    private UUID slotId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status", length = 24, nullable = false)
    private InventoryStatus status = InventoryStatus.AVAILABLE;

    @Column(name = "loaded_at", columnDefinition = "timestamptz")
    private Instant loadedAt;

    @Column(name = "reserved_at", columnDefinition = "timestamptz")
    private Instant reservedAt;

    @Column(name = "sold_at", columnDefinition = "timestamptz")
    private Instant soldAt;

    @Column(name = "removed_at", columnDefinition = "timestamptz")
    private Instant removedAt;

    @OneToMany(mappedBy = "inventoryItem", fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    private Set<OrderItemAllocation> allocations = new HashSet<>();
}
