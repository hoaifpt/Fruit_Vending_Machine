package com.fruitmachine.backend.inventory.entity;

import com.fruitmachine.backend.inventory.enums.InventoryTransactionType;
import com.fruitmachine.backend.inventory.enums.InventoryStatus;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.machine.entity.MachineSlot;
import com.fruitmachine.backend.user.entity.User;

import com.fruitmachine.backend.common.entity.UuidEntity;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.Immutable;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "inventory_transactions")
@Immutable
@Getter
@Setter
@NoArgsConstructor
public class InventoryTransaction extends UuidEntity {
    // Generate before INSERT: Hibernate cannot refresh DB-generated fields on @Immutable rows.
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "timestamptz")
    @Setter(AccessLevel.NONE)
    private Instant createdAt;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "inventory_item_id", nullable = false)
    private InventoryItem inventoryItem;

    @Column(name = "machine_id")
    private UUID machineId;

    @Column(name = "slot_id")
    private UUID slotId;

    @ManyToOne(fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    @JoinColumn(name = "machine_id", insertable = false, updatable = false)
    private Machine machine;

    // Read-only navigation: the UUID columns above own writes to the composite FK.
    @ManyToOne(fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    @JoinColumns({
        @JoinColumn(name = "slot_id", referencedColumnName = "id", insertable = false, updatable = false),
        @JoinColumn(name = "machine_id", referencedColumnName = "machine_id", insertable = false, updatable = false)
    })
    private MachineSlot slot;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "type", length = 16, nullable = false)
    private InventoryTransactionType type;

    @Column(name = "reference_id")
    private UUID referenceId;

    @Column(name = "reason", length = 500)
    private String reason;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status_before", length = 24)
    private InventoryStatus statusBefore;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status_after", length = 24)
    private InventoryStatus statusAfter;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "performed_by")
    private User performedBy;
}
