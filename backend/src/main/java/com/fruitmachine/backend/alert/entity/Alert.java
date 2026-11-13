package com.fruitmachine.backend.alert.entity;

import com.fruitmachine.backend.alert.enums.AlertSeverity;
import com.fruitmachine.backend.alert.enums.AlertStatus;
import com.fruitmachine.backend.alert.enums.AlertType;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.machine.entity.MachineSlot;
import com.fruitmachine.backend.common.entity.UpdatedEntity;
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

/**
 * One problem of a machine or slot (issue #58). Created and auto-resolved by AlertService with conditional SQL keyed by dedupeKey
 * (at most one unresolved alert per key); acknowledged and resolved by staff through the API.
 */
@Entity
@Table(name = "alerts")
@Getter
@Setter
@NoArgsConstructor
public class Alert extends UpdatedEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "machine_id", nullable = false)
    private Machine machine;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "type", length = 32, nullable = false)
    private AlertType type;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "severity", length = 16, nullable = false)
    private AlertSeverity severity;

    @Column(name = "title", length = 255, nullable = false)
    private String title;

    @Column(name = "message", columnDefinition = "text")
    private String message;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status", length = 16, nullable = false)
    private AlertStatus status = AlertStatus.OPEN;

    @Column(name = "triggered_at", columnDefinition = "timestamptz", nullable = false)
    private Instant triggeredAt = Instant.now();

    @Column(name = "resolved_at", columnDefinition = "timestamptz")
    private Instant resolvedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "resolved_by")
    private User resolvedBy;

    /** Slot-scoped alerts (stock, expiry, dispense); null for machine-scoped ones. Composite FK (slot_id, machine_id). */
    @Column(name = "slot_id")
    private UUID slotId;

    // Read-only navigation: slot_id owns the write.
    @ManyToOne(fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    @JoinColumn(name = "slot_id", insertable = false, updatable = false)
    private MachineSlot slot;

    @Column(name = "error_code", length = 64)
    private String errorCode;

    @Column(name = "dedupe_key", length = 160, nullable = false)
    private String dedupeKey;

    @Column(name = "acknowledged_at", columnDefinition = "timestamptz")
    private Instant acknowledgedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "acknowledged_by")
    private User acknowledgedBy;

    @Column(name = "resolution_note", length = 500)
    private String resolutionNote;
}
