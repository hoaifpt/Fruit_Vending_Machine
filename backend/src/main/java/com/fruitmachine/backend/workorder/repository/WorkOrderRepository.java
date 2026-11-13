package com.fruitmachine.backend.workorder.repository;

import com.fruitmachine.backend.workorder.entity.WorkOrder;
import com.fruitmachine.backend.workorder.enums.WorkOrderPriority;
import com.fruitmachine.backend.workorder.enums.WorkOrderSource;
import com.fruitmachine.backend.workorder.enums.WorkOrderStatus;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface WorkOrderRepository extends JpaRepository<WorkOrder, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select w from WorkOrder w where w.id = :id")
    Optional<WorkOrder> findForUpdateById(@Param("id") UUID id);

    @Query("""
            select w from WorkOrder w join fetch w.machine left join fetch w.assignee left join fetch w.createdBy
            left join fetch w.completedBy left join fetch w.cancelledBy where w.id = :id""")
    Optional<WorkOrder> findDetailsById(@Param("id") UUID id);

    @Query("select w.machineId from WorkOrder w where w.id = :id")
    Optional<UUID> findMachineIdById(@Param("id") UUID id);

    boolean existsByCode(String code);

    boolean existsByMachineIdAndStatus(UUID machineId, WorkOrderStatus status);

    /** Priority first (URGENT, HIGH, NORMAL, LOW), then due time (none last), then oldest first; every filter optional. */
    @Query(value = """
            select w from WorkOrder w join fetch w.machine left join fetch w.assignee left join fetch w.createdBy
            left join fetch w.completedBy left join fetch w.cancelledBy
            where w.status in :statuses
              and (:type is null or w.type = :type)
              and (:source is null or w.source = :source)
              and (:machineId is null or w.machineId = :machineId)
              and (:assigneeId is null or w.assignee.id = :assigneeId)
              and (:priority is null or w.priority = :priority)
              and (:overdue = false or (w.dueAt < :now and w.status in :unfinished))
              and w.createdAt >= :from and w.createdAt < :to
            order by case w.priority when com.fruitmachine.backend.workorder.enums.WorkOrderPriority.URGENT then 0
                                     when com.fruitmachine.backend.workorder.enums.WorkOrderPriority.HIGH then 1
                                     when com.fruitmachine.backend.workorder.enums.WorkOrderPriority.NORMAL then 2 else 3 end,
                     w.dueAt asc nulls last, w.createdAt, w.id""",
            countQuery = """
            select count(w) from WorkOrder w
            where w.status in :statuses
              and (:type is null or w.type = :type)
              and (:source is null or w.source = :source)
              and (:machineId is null or w.machineId = :machineId)
              and (:assigneeId is null or w.assignee.id = :assigneeId)
              and (:priority is null or w.priority = :priority)
              and (:overdue = false or (w.dueAt < :now and w.status in :unfinished))
              and w.createdAt >= :from and w.createdAt < :to""")
    Page<WorkOrder> search(@Param("statuses") Collection<WorkOrderStatus> statuses, @Param("type") WorkOrderType type,
            @Param("source") WorkOrderSource source, @Param("machineId") UUID machineId, @Param("assigneeId") UUID assigneeId,
            @Param("priority") WorkOrderPriority priority, @Param("overdue") boolean overdue, @Param("now") Instant now,
            @Param("unfinished") Collection<WorkOrderStatus> unfinished, @Param("from") Instant from, @Param("to") Instant to, Pageable pageable);

    @Query("select w.id from WorkOrder w where w.dueAt < :now and w.status in :unfinished and w.overdueNotifiedAt is null order by w.dueAt, w.id")
    List<UUID> findOverdueIds(@Param("now") Instant now, @Param("unfinished") Collection<WorkOrderStatus> unfinished, Pageable limit);

    /** ACTIVE users who may execute work orders (a valid assignee). */
    @Query(value = """
            SELECT EXISTS (SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN role_permissions rp ON rp.role_id = ur.role_id
                           JOIN permissions p ON p.id = rp.permission_id
                           WHERE u.id = :userId AND u.status = 'ACTIVE' AND p.code = 'WORK_ORDER_EXECUTE')""", nativeQuery = true)
    boolean canExecute(@Param("userId") UUID userId);

    /** ACTIVE users holding WORK_ORDER_MANAGE (notified about system-created or unassigned overdue work orders). */
    @Query(value = """
            SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN role_permissions rp ON rp.role_id = ur.role_id
            JOIN permissions p ON p.id = rp.permission_id WHERE u.status = 'ACTIVE' AND p.code = 'WORK_ORDER_MANAGE'""", nativeQuery = true)
    List<UUID> findManagerIds();
}
