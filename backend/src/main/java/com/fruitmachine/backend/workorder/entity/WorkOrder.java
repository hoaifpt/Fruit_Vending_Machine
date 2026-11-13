package com.fruitmachine.backend.workorder.entity;

import com.fruitmachine.backend.common.entity.UpdatedEntity;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.workorder.enums.WorkOrderPriority;
import com.fruitmachine.backend.workorder.enums.WorkOrderSource;
import com.fruitmachine.backend.workorder.enums.WorkOrderStatus;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** One work order (V20). Changed only by WorkOrderService under its row lock; never deleted. */
@Entity
@Table(name = "work_orders")
@Getter
@Setter
@NoArgsConstructor
public class WorkOrder extends UpdatedEntity {
    @Column(name = "code", length = 32, nullable = false, unique = true)
    private String code;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "type", length = 16, nullable = false)
    private WorkOrderType type;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "source", length = 24, nullable = false)
    private WorkOrderSource source;

    @Column(name = "machine_id", nullable = false)
    private UUID machineId;

    @ManyToOne(fetch = FetchType.LAZY)
    @Setter(AccessLevel.NONE)
    @JoinColumn(name = "machine_id", insertable = false, updatable = false)
    private Machine machine;

    @Column(name = "title", length = 200, nullable = false)
    private String title;

    @Column(name = "description", length = 2000)
    private String description;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "priority", length = 8, nullable = false)
    private WorkOrderPriority priority = WorkOrderPriority.NORMAL;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status", length = 16, nullable = false)
    private WorkOrderStatus status = WorkOrderStatus.OPEN;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assignee_id")
    private User assignee;

    @Column(name = "due_at", columnDefinition = "timestamptz")
    private Instant dueAt;

    /** NULL = created by the system (alert, schedule, customer report). */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by")
    private User createdBy;

    @Column(name = "started_at", columnDefinition = "timestamptz")
    private Instant startedAt;

    @Column(name = "completed_at", columnDefinition = "timestamptz")
    private Instant completedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "completed_by")
    private User completedBy;

    @Column(name = "result_note", length = 2000)
    private String resultNote;

    @Column(name = "cancelled_at", columnDefinition = "timestamptz")
    private Instant cancelledAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "cancelled_by")
    private User cancelledBy;

    @Column(name = "cancel_reason", length = 500)
    private String cancelReason;

    @Column(name = "overdue_notified_at", columnDefinition = "timestamptz")
    private Instant overdueNotifiedAt;

    /** Optimistic version the Admin sends back on edit / assign / cancel (stale -> 409). */
    @Version
    @Column(name = "version", nullable = false)
    private Long version;
}
