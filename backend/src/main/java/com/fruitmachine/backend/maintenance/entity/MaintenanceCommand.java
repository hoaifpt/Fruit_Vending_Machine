package com.fruitmachine.backend.maintenance.entity;

import com.fruitmachine.backend.common.entity.UpdatedEntity;
import com.fruitmachine.backend.inventory.entity.InventoryItem;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.machine.entity.MachineSlot;
import com.fruitmachine.backend.maintenance.enums.MaintenanceCommandStatus;
import com.fruitmachine.backend.maintenance.enums.MaintenanceOperation;
import com.fruitmachine.backend.maintenance.enums.MaintenanceReason;
import com.fruitmachine.backend.maintenance.enums.ReconciliationOutcome;
import com.fruitmachine.backend.user.entity.User;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** One maintenance command (V19). Written by MaintenanceCommandService only; never deleted. */
@Entity
@Table(name = "maintenance_commands")
@Getter
@Setter
@NoArgsConstructor
public class MaintenanceCommand extends UpdatedEntity {
    @Column(name = "command_code", length = 39, nullable = false, unique = true)
    private String commandCode;

    @Column(name = "machine_id", nullable = false)
    private UUID machineId;

    @ManyToOne(fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    @JoinColumn(name = "machine_id", insertable = false, updatable = false)
    private Machine machine;

    @Column(name = "slot_id")
    private UUID slotId;

    // Read-only navigation: slot_id with machine_id owns the composite FK.
    @ManyToOne(fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    @JoinColumn(name = "slot_id", insertable = false, updatable = false)
    private MachineSlot slot;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "operation", length = 24, nullable = false)
    private MaintenanceOperation operation;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status", length = 24, nullable = false)
    private MaintenanceCommandStatus status = MaintenanceCommandStatus.PENDING;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "reason", length = 24)
    private MaintenanceReason reason;

    @Column(name = "note", length = 500)
    private String note;

    /** REMOVE_ITEM: the head bowl when the command was created. */
    @Column(name = "target_inventory_item_id")
    private UUID targetInventoryItemId;

    @ManyToOne(fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    @JoinColumn(name = "target_inventory_item_id", insertable = false, updatable = false)
    private InventoryItem targetItem;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "requested_by", nullable = false)
    private User requestedBy;

    /** Issue #68: the work order this command serves (e.g. removing old bowls during a restock). */
    @Column(name = "work_order_id")
    private UUID workOrderId;

    @Column(name = "idempotency_key", length = 64, nullable = false)
    private String idempotencyKey;

    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @Column(name = "sent_at", columnDefinition = "timestamptz")
    private Instant sentAt;

    @Column(name = "accepted_at", columnDefinition = "timestamptz")
    private Instant acceptedAt;

    @Column(name = "finished_at", columnDefinition = "timestamptz")
    private Instant finishedAt;

    @Column(name = "failure_reason", length = 48)
    private String failureReason;

    @Column(name = "removed_count")
    private Integer removedCount;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "reconciled_by")
    private User reconciledBy;

    @Column(name = "reconciled_at", columnDefinition = "timestamptz")
    private Instant reconciledAt;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "reconciliation_outcome", length = 16)
    private ReconciliationOutcome reconciliationOutcome;
}
