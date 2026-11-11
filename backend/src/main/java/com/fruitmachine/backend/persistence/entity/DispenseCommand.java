package com.fruitmachine.backend.persistence.entity;

import com.fruitmachine.backend.persistence.enums.DispenseStatus;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "dispense_commands")
@Getter
@Setter
@NoArgsConstructor
public class DispenseCommand extends UpdatedEntity {
    @Column(name = "command_code", length = 64, nullable = false, unique = true)
    private String commandCode;

    @Column(name = "order_id", nullable = false)
    private UUID orderId;

    @Column(name = "machine_id", nullable = false)
    private UUID machineId;

    @Column(name = "slot_id", nullable = false)
    private UUID slotId;

    @Column(name = "inventory_item_id", nullable = false)
    private UUID inventoryItemId;

    // Read-only navigation: the UUID columns above own writes to the composite FK.
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @Setter(AccessLevel.NONE)
    @JoinColumns({
        @JoinColumn(name = "order_id", referencedColumnName = "id", insertable = false, updatable = false, nullable = false),
        @JoinColumn(name = "machine_id", referencedColumnName = "machine_id", insertable = false, updatable = false, nullable = false)
    })
    private Order order;

    @ManyToOne(fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    @JoinColumn(name = "machine_id", insertable = false, updatable = false)
    private Machine machine;

    // Read-only navigation: the UUID columns above own writes to the composite FK.
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @Setter(AccessLevel.NONE)
    @JoinColumns({
        @JoinColumn(name = "slot_id", referencedColumnName = "id", insertable = false, updatable = false, nullable = false),
        @JoinColumn(name = "machine_id", referencedColumnName = "machine_id", insertable = false, updatable = false, nullable = false)
    })
    private MachineSlot slot;

    // Read-only navigation: the UUID columns above own writes to the composite FK.
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @Setter(AccessLevel.NONE)
    @JoinColumns({
        @JoinColumn(name = "inventory_item_id", referencedColumnName = "id", insertable = false, updatable = false, nullable = false),
        @JoinColumn(name = "slot_id", referencedColumnName = "slot_id", insertable = false, updatable = false, nullable = false)
    })
    private InventoryItem inventoryItem;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status", length = 16, nullable = false)
    private DispenseStatus status = DispenseStatus.PENDING;

    @Column(name = "sent_at", columnDefinition = "timestamptz")
    private Instant sentAt;

    @Column(name = "acknowledged_at", columnDefinition = "timestamptz")
    private Instant acknowledgedAt;

    @Column(name = "completed_at", columnDefinition = "timestamptz")
    private Instant completedAt;
}
