package com.fruitmachine.backend.workorder.entity;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.common.entity.CreatedEntity;
import com.fruitmachine.backend.user.entity.User;
import com.fruitmachine.backend.workorder.enums.WorkOrderEventType;
import com.fruitmachine.backend.workorder.enums.WorkOrderStatus;
import jakarta.persistence.*;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** One history row (append-only: a database trigger rejects UPDATE and DELETE). */
@Entity
@Table(name = "work_order_events")
@Getter
@Setter
@NoArgsConstructor
public class WorkOrderEvent extends CreatedEntity {
    @Column(name = "work_order_id", nullable = false)
    private UUID workOrderId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "type", length = 24, nullable = false)
    private WorkOrderEventType type;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status_before", length = 16)
    private WorkOrderStatus statusBefore;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(name = "status_after", length = 16)
    private WorkOrderStatus statusAfter;

    /** NULL = the system. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "actor_id")
    private User actor;

    @Column(name = "note", length = 2000)
    private String note;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "details", columnDefinition = "jsonb")
    private JsonNode details;
}
