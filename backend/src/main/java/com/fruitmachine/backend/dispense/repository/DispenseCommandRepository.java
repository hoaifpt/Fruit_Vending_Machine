package com.fruitmachine.backend.dispense.repository;

import com.fruitmachine.backend.dispense.entity.DispenseCommand;
import com.fruitmachine.backend.dispense.enums.DispenseStatus;
import jakarta.persistence.LockModeType;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DispenseCommandRepository extends JpaRepository<DispenseCommand, UUID> {
    boolean existsByOrderId(UUID orderId);

    /** Issue #72: an unfinished dispense command blocks a refund of its order. */
    boolean existsByOrderIdAndStatusIn(UUID orderId, Collection<DispenseStatus> statuses);

    boolean existsByCommandCode(String commandCode);

    @Query("""
            select new com.fruitmachine.backend.dispense.repository.CommandRoute(c.id, c.orderId, c.machineId, m.code, c.status, c.sentAt)
            from DispenseCommand c join c.machine m where c.commandCode = :code""")
    Optional<CommandRoute> findRouteByCommandCode(@Param("code") String commandCode);

    @Query("""
            select new com.fruitmachine.backend.dispense.repository.CommandRoute(c.id, c.orderId, c.machineId, m.code, c.status, c.sentAt)
            from DispenseCommand c join c.machine m where c.id = :id""")
    Optional<CommandRoute> findRouteById(@Param("id") UUID id);

    /** Another command of the machine that was published and has no result yet (the firmware runs one command at a time). */
    @Query("select count(c) > 0 from DispenseCommand c where c.machineId = :machineId and c.status in :statuses and c.id <> :id")
    boolean existsOtherByMachineIdAndStatusIn(@Param("machineId") UUID machineId, @Param("statuses") Collection<DispenseStatus> statuses,
            @Param("id") UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from DispenseCommand c where c.id = :id")
    Optional<DispenseCommand> findForUpdateById(@Param("id") UUID id);

    /** Issue #64: a dispense command of the machine in one of these states (maintenance waits for running dispenses). */
    boolean existsByMachineIdAndStatusIn(UUID machineId, Collection<DispenseStatus> statuses);

    @Query("select c.id from DispenseCommand c where c.status in :statuses order by c.createdAt, c.id")
    List<UUID> findIdsByStatusIn(@Param("statuses") Collection<DispenseStatus> statuses, Pageable limit);
}
