package com.fruitmachine.backend.machine.kiosk.repository;

import com.fruitmachine.backend.machine.kiosk.entity.KioskCredential;
import com.fruitmachine.backend.machine.kiosk.enums.KioskCredentialStatus;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface KioskCredentialRepository extends JpaRepository<KioskCredential, UUID> {
    boolean existsByKeyPrefix(String keyPrefix);

    @EntityGraph(attributePaths = {"machine"})
    Optional<KioskCredential> findByKeyPrefix(String keyPrefix);

    Optional<KioskCredential> findByMachineIdAndStatus(UUID machineId, KioskCredentialStatus status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from KioskCredential c where c.id = :id and c.machine.id = :machineId")
    Optional<KioskCredential> findForUpdateByIdAndMachineId(@Param("id") UUID id, @Param("machineId") UUID machineId);

    @Query("select c from KioskCredential c where c.machine.id = :machineId order by c.createdAt desc, c.id")
    List<KioskCredential> findHistoryByMachineId(@Param("machineId") UUID machineId);
}
