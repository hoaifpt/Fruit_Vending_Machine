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

    boolean existsByCommandCode(String commandCode);

    @Query("select c.id from DispenseCommand c where c.commandCode = :code")
    Optional<UUID> findIdByCommandCode(@Param("code") String commandCode);

    @Query("select c.orderId from DispenseCommand c where c.id = :id")
    Optional<UUID> findOrderIdById(@Param("id") UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from DispenseCommand c where c.id = :id")
    Optional<DispenseCommand> findForUpdateById(@Param("id") UUID id);

    @Query("select c.id from DispenseCommand c where c.status in :statuses order by c.createdAt, c.id")
    List<UUID> findIdsByStatusIn(@Param("statuses") Collection<DispenseStatus> statuses, Pageable limit);
}
