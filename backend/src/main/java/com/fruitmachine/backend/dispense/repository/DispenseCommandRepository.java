package com.fruitmachine.backend.dispense.repository;

import com.fruitmachine.backend.dispense.entity.DispenseCommand;
import com.fruitmachine.backend.dispense.enums.DispenseStatus;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface DispenseCommandRepository extends JpaRepository<DispenseCommand, UUID> {
    Optional<DispenseCommand> findByOrderIdAndMachineId(UUID orderId, UUID machineId);
    Optional<DispenseCommand> findByIdAndMachineId(UUID id, UUID machineId);
    @Query("select d.orderId from DispenseCommand d where d.id = :id and d.machineId = :machineId")
    Optional<UUID> findOrderId(UUID id, UUID machineId);
    @Query("select d.orderId from DispenseCommand d where d.id = :id")
    Optional<UUID> findOrderId(UUID id);
    List<DispenseCommand> findByMachineIdAndStatusOrderByCreatedAtAscIdAsc(UUID machineId, DispenseStatus status, Pageable limit);
    boolean existsByMachineIdAndStatusIn(UUID machineId, List<DispenseStatus> statuses);
    @Query("select d.id from DispenseCommand d where d.status in :statuses and coalesce(d.sentAt, d.createdAt) < :deadline order by d.createdAt, d.id")
    List<UUID> findTimedOut(List<DispenseStatus> statuses, Instant deadline, Pageable limit);
}
