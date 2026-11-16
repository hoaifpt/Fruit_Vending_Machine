package com.fruitmachine.backend.maintenanceplan.repository;

import com.fruitmachine.backend.maintenanceplan.entity.MaintenancePlan;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface MaintenancePlanRepository extends JpaRepository<MaintenancePlan, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from MaintenancePlan p where p.id = :id")
    Optional<MaintenancePlan> findForUpdateById(@Param("id") UUID id);

    @Query("select p from MaintenancePlan p join fetch p.machine left join fetch p.defaultAssignee join fetch p.createdBy where p.id = :id")
    Optional<MaintenancePlan> findDetailsById(@Param("id") UUID id);

    @Query(value = """
            select p from MaintenancePlan p join fetch p.machine left join fetch p.defaultAssignee join fetch p.createdBy
            where (:machineId is null or p.machineId = :machineId) and (:active is null or p.active = :active)
            order by p.nextDueDate, p.title, p.id""",
            countQuery = "select count(p) from MaintenancePlan p where (:machineId is null or p.machineId = :machineId) and (:active is null or p.active = :active)")
    Page<MaintenancePlan> search(@Param("machineId") UUID machineId, @Param("active") Boolean active, Pageable pageable);

    /** Active plans due up to {@code until} (overdue ones included), for the upcoming view. */
    @Query("""
            select p from MaintenancePlan p join fetch p.machine left join fetch p.defaultAssignee join fetch p.createdBy
            where p.active = true and p.nextDueDate <= :until and (:machineId is null or p.machineId = :machineId)
            order by p.nextDueDate, p.title, p.id""")
    List<MaintenancePlan> findUpcoming(@Param("until") LocalDate until, @Param("machineId") UUID machineId);

    /**
     * Active plans whose occurrence is due (next_due_date - lead_days <= today), on a machine that is not INACTIVE, without an unfinished
     * work order; the generator re-checks each under the plan's row lock.
     */
    @Query(value = """
            SELECT p.id FROM maintenance_plans p JOIN machines m ON m.id = p.machine_id
            WHERE p.active AND m.status <> 'INACTIVE' AND p.next_due_date - p.lead_days <= :today
              AND NOT EXISTS (SELECT 1 FROM work_orders w WHERE w.maintenance_plan_id = p.id AND w.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS'))
            ORDER BY p.next_due_date, p.id""", nativeQuery = true)
    List<UUID> findDueIds(@Param("today") LocalDate today);

    @Query(value = "SELECT pg_try_advisory_xact_lock(4609613, 5)", nativeQuery = true)
    boolean tryLockRun();
}
