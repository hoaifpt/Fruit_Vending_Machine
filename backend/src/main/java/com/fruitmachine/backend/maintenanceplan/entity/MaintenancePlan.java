package com.fruitmachine.backend.maintenanceplan.entity;

import com.fruitmachine.backend.common.entity.UpdatedEntity;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.workorder.enums.WorkOrderPriority;
import jakarta.persistence.*;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** A recurring maintenance plan (V22). Never deleted: deactivated instead, so its work orders stay linked. */
@Entity
@Table(name = "maintenance_plans")
@Getter
@Setter
@NoArgsConstructor
public class MaintenancePlan extends UpdatedEntity {
    @Column(name = "machine_id", nullable = false)
    private UUID machineId;

    @ManyToOne(fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    @JoinColumn(name = "machine_id", insertable = false, updatable = false)
    private Machine machine;

    @Column(name = "title", length = 200, nullable = false)
    private String title;

    @Column(name = "instructions", length = 2000)
    private String instructions;

    @Column(name = "interval_days", nullable = false)
    private int intervalDays;

    @Column(name = "lead_days", nullable = false)
    private int leadDays;

    /** Local time in the business zone. */
    @Column(name = "due_time", nullable = false, columnDefinition = "time")
    private LocalTime dueTime = LocalTime.of(17, 0);

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "priority", length = 8, nullable = false)
    private WorkOrderPriority priority = WorkOrderPriority.NORMAL;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "default_assignee_id")
    private User defaultAssignee;

    /** Business-zone date of the next occurrence. */
    @Column(name = "next_due_date", nullable = false)
    private LocalDate nextDueDate;

    @Column(name = "active", nullable = false)
    private boolean active = true;

    @Column(name = "last_completed_at", columnDefinition = "timestamptz")
    private Instant lastCompletedAt;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "created_by", nullable = false)
    private User createdBy;

    @Version
    @Column(name = "version", nullable = false)
    private Long version;
}
