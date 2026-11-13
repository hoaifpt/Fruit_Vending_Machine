package com.fruitmachine.backend.workorder.entity;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.Generated;
import org.hibernate.generator.EventType;

/** A work order handles an alert (work_order_alerts). Kept after the work order ends, as history. */
@Entity
@Table(name = "work_order_alerts")
@Getter
@NoArgsConstructor
public class WorkOrderAlert {
    @EmbeddedId
    private WorkOrderAlertId id;

    @Generated(event = EventType.INSERT)
    @Column(name = "created_at", nullable = false, insertable = false, updatable = false, columnDefinition = "timestamptz")
    private Instant createdAt;

    public WorkOrderAlert(WorkOrderAlertId id) {
        this.id = id;
    }
}
