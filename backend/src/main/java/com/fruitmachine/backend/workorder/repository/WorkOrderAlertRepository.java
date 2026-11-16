package com.fruitmachine.backend.workorder.repository;

import com.fruitmachine.backend.workorder.entity.WorkOrderAlert;
import com.fruitmachine.backend.workorder.entity.WorkOrderAlertId;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface WorkOrderAlertRepository extends JpaRepository<WorkOrderAlert, WorkOrderAlertId> {
    /** The unfinished work order (if any) handling each of these alerts. */
    interface ActiveLink {
        UUID getAlertId(); UUID getWorkOrderId(); String getCode();
    }

    @Query(value = """
            SELECT l.alert_id AS "alertId", w.id AS "workOrderId", w.code AS "code"
            FROM work_order_alerts l JOIN work_orders w ON w.id = l.work_order_id
            WHERE l.alert_id IN (:alertIds) AND w.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')""", nativeQuery = true)
    List<ActiveLink> findActiveLinks(@Param("alertIds") Collection<UUID> alertIds);

    /** Linked alerts of these work orders, for responses. */
    interface LinkedAlert {
        UUID getWorkOrderId(); UUID getAlertId(); String getType(); String getSeverity(); String getStatus(); String getTitle();
    }

    @Query(value = """
            SELECT l.work_order_id AS "workOrderId", a.id AS "alertId", a.type AS "type", a.severity AS "severity", a.status AS "status",
                   a.title AS "title"
            FROM work_order_alerts l JOIN alerts a ON a.id = l.alert_id
            WHERE l.work_order_id IN (:workOrderIds) ORDER BY a.triggered_at, a.id""", nativeQuery = true)
    List<LinkedAlert> findLinkedAlerts(@Param("workOrderIds") Collection<UUID> workOrderIds);

    @Query("select l.id.alertId from WorkOrderAlert l where l.id.workOrderId = :workOrderId")
    List<UUID> findAlertIds(@Param("workOrderId") UUID workOrderId);
}
