package com.fruitmachine.backend.machine.repository;

import com.fruitmachine.backend.machine.entity.Machine;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface MachineRepository extends JpaRepository<Machine, UUID>, JpaSpecificationExecutor<Machine> {
    boolean existsByCode(String code);

    /** Records that the machine was heard from (any MQTT message); not a configuration change. */
    @Transactional
    @Modifying
    @Query("update Machine m set m.lastSeenAt = :at where m.code = :code")
    int touchLastSeen(@Param("code") String code, @Param("at") Instant at);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select m from Machine m where m.id = :id")
    Optional<Machine> findForUpdateById(@Param("id") UUID id);

    /** Shared lock: serializes with status/configuration writes (PESSIMISTIC_WRITE) without blocking other orders. */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select m from Machine m where m.id = :id")
    Optional<Machine> findForShareById(@Param("id") UUID id);
}
