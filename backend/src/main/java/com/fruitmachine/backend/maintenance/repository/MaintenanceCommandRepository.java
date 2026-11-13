package com.fruitmachine.backend.maintenance.repository;

import com.fruitmachine.backend.maintenance.entity.MaintenanceCommand;
import com.fruitmachine.backend.maintenance.enums.MaintenanceCommandStatus;
import jakarta.persistence.LockModeType;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface MaintenanceCommandRepository extends JpaRepository<MaintenanceCommand, UUID>, JpaSpecificationExecutor<MaintenanceCommand> {

    @Override
    @EntityGraph(attributePaths = {"machine", "slot", "targetItem", "targetItem.batch", "targetItem.batch.product", "requestedBy", "reconciledBy"})
    Page<MaintenanceCommand> findAll(Specification<MaintenanceCommand> specification, Pageable pageable);

    @EntityGraph(attributePaths = {"machine", "slot", "targetItem", "targetItem.batch", "targetItem.batch.product", "requestedBy", "reconciledBy"})
    @Query("select c from MaintenanceCommand c where c.id = :id")
    Optional<MaintenanceCommand> findDetailsById(@Param("id") UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from MaintenanceCommand c where c.id = :id")
    Optional<MaintenanceCommand> findForUpdateById(@Param("id") UUID id);

    /** Unlocked routing read for a machine report: id, machine and operation never change. */
    interface Route {
        UUID getId(); UUID getMachineId(); String getMachineCode(); com.fruitmachine.backend.maintenance.enums.MaintenanceOperation getOperation();
    }

    @Query("select c.id as id, c.machineId as machineId, m.code as machineCode, c.operation as operation from MaintenanceCommand c join c.machine m where c.commandCode = :code")
    Optional<Route> findRouteByCommandCode(@Param("code") String code);

    @Query("select c.machineId from MaintenanceCommand c where c.id = :id")
    Optional<UUID> findMachineIdById(@Param("id") UUID id);

    Optional<MaintenanceCommand> findByRequestedByIdAndIdempotencyKey(UUID requestedBy, String idempotencyKey);

    boolean existsByMachineIdAndStatusIn(UUID machineId, Collection<MaintenanceCommandStatus> statuses);

    boolean existsByCommandCode(String commandCode);

    @Query("select c.id from MaintenanceCommand c where c.status in :statuses order by c.createdAt, c.id")
    List<UUID> findIdsByStatusIn(@Param("statuses") Collection<MaintenanceCommandStatus> statuses, Pageable limit);
}
