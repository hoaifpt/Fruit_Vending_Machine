package com.fruitmachine.backend.alert.repository;

import com.fruitmachine.backend.alert.entity.Alert;
import com.fruitmachine.backend.alert.enums.AlertSeverity;
import com.fruitmachine.backend.alert.enums.AlertStatus;
import com.fruitmachine.backend.alert.enums.AlertType;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/** Alert reads and the row lock of a staff transition; system inserts/resolves go through AlertWriter. No delete method. */
public interface AlertRepository extends Repository<Alert, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from Alert a where a.id = :id")
    Optional<Alert> findForUpdateById(@Param("id") UUID id);

    @Query("""
            select a from Alert a join fetch a.machine left join fetch a.slot left join fetch a.acknowledgedBy left join fetch a.resolvedBy
            where a.id = :id""")
    Optional<Alert> findDetailsById(@Param("id") UUID id);

    void flush();

    /** Severity first (CRITICAL, WARNING, INFO), then newest; every filter but statuses and the time range is optional. */
    @Query(value = """
            select a from Alert a join fetch a.machine left join fetch a.slot left join fetch a.acknowledgedBy left join fetch a.resolvedBy
            where a.status in :statuses
              and (:type is null or a.type = :type)
              and (:severity is null or a.severity = :severity)
              and (:machineId is null or a.machine.id = :machineId)
              and (:slotId is null or a.slotId = :slotId)
              and (:errorCode is null or a.errorCode = :errorCode)
              and a.triggeredAt >= :from and a.triggeredAt < :to
            order by case a.severity when com.fruitmachine.backend.alert.enums.AlertSeverity.CRITICAL then 0
                                     when com.fruitmachine.backend.alert.enums.AlertSeverity.WARNING then 1 else 2 end,
                     a.triggeredAt desc, a.id desc""",
            countQuery = """
            select count(a) from Alert a
            where a.status in :statuses
              and (:type is null or a.type = :type)
              and (:severity is null or a.severity = :severity)
              and (:machineId is null or a.machine.id = :machineId)
              and (:slotId is null or a.slotId = :slotId)
              and (:errorCode is null or a.errorCode = :errorCode)
              and a.triggeredAt >= :from and a.triggeredAt < :to""")
    Page<Alert> search(@Param("statuses") Collection<AlertStatus> statuses, @Param("type") AlertType type, @Param("severity") AlertSeverity severity,
            @Param("machineId") UUID machineId, @Param("slotId") UUID slotId, @Param("errorCode") String errorCode,
            @Param("from") Instant from, @Param("to") Instant to, Pageable pageable);
}
