package com.fruitmachine.backend.workorder.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.io.Serializable;
import java.util.UUID;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Embeddable
@Getter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class WorkOrderAlertId implements Serializable {
    @Column(name = "work_order_id", nullable = false)
    private UUID workOrderId;

    @Column(name = "alert_id", nullable = false)
    private UUID alertId;
}
