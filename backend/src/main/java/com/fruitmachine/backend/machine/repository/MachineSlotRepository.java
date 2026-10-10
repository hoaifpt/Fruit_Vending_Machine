package com.fruitmachine.backend.machine.repository;

import com.fruitmachine.backend.machine.entity.MachineSlot;
import com.fruitmachine.backend.machine.enums.SlotStatus;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;

public interface MachineSlotRepository extends JpaRepository<MachineSlot, UUID> {
    boolean existsByMachineIdAndSlotCode(UUID machineId, String slotCode);
    Page<MachineSlot> findByMachineId(UUID machineId, Pageable pageable);
    Page<MachineSlot> findByMachineIdAndStatus(UUID machineId, SlotStatus status, Pageable pageable);
    Optional<MachineSlot> findByIdAndMachineId(UUID id, UUID machineId);
    @Query("select s.machineId from MachineSlot s where s.id = :id")
    Optional<UUID> findMachineIdById(@Param("id") UUID id);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from MachineSlot s where s.id = :id")
    Optional<MachineSlot> findForUpdateById(@Param("id") UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from MachineSlot s where s.id = :id and s.machineId = :machineId")
    Optional<MachineSlot> findForUpdateByIdAndMachineId(@Param("id") UUID id, @Param("machineId") UUID machineId);
}
