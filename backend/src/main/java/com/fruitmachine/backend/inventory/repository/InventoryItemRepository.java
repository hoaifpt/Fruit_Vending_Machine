package com.fruitmachine.backend.inventory.repository;

import com.fruitmachine.backend.inventory.entity.InventoryItem;
import com.fruitmachine.backend.inventory.enums.InventoryStatus;
import com.fruitmachine.backend.product.enums.ProductStatus;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.*;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;

public interface InventoryItemRepository extends JpaRepository<InventoryItem, UUID>, JpaSpecificationExecutor<InventoryItem> {
    @Override @EntityGraph(attributePaths = {"batch", "batch.product", "slot", "slot.machine"})
    Page<InventoryItem> findAll(Specification<InventoryItem> specification, Pageable pageable);
    @Override @EntityGraph(attributePaths = {"batch", "batch.product", "slot", "slot.machine"})
    Optional<InventoryItem> findById(UUID id);
    @Lock(LockModeType.PESSIMISTIC_WRITE) @Query("select i from InventoryItem i where i.id = :id")
    Optional<InventoryItem> findForUpdateById(@Param("id") UUID id);
    @Query("select i.slotId from InventoryItem i where i.id = :id")
    UUID findSlotIdById(@Param("id") UUID id);
    long countByBatchId(UUID batchId);
    long countBySlotIdAndStatusIn(UUID slotId, Collection<InventoryStatus> statuses);

    interface Counts {
        Long getOccupied(); Long getAvailable(); Long getExpired(); Long getReserved(); Long getActiveProductAvailable();
        Integer getCapacity();
        com.fruitmachine.backend.machine.enums.SlotStatus getSlotStatus();
        com.fruitmachine.backend.machine.enums.MachineStatus getMachineStatus();
    }
    @Query("""
        select coalesce(sum(case when i.status in :physical then 1 else 0 end),0) as occupied,
               coalesce(sum(case when i.status = :available and b.expiresAt > :now then 1 else 0 end),0) as available,
               coalesce(sum(case when i.status in :physical and (b.expiresAt <= :now or i.status = :expired) then 1 else 0 end),0) as expired,
               coalesce(sum(case when i.status = :reserved then 1 else 0 end),0) as reserved,
               coalesce(sum(case when i.status = :available and b.expiresAt > :now and p.status = :active then 1 else 0 end),0) as activeProductAvailable,
               s.capacity as capacity, s.status as slotStatus, m.status as machineStatus
        from MachineSlot s join s.machine m left join InventoryItem i on i.slotId = s.id
        left join i.batch b left join b.product p where s.id = :slotId
        group by s.capacity, s.status, m.status
        """)
    Counts counts(@Param("slotId") UUID slotId, @Param("now") Instant now, @Param("physical") Collection<InventoryStatus> physical,
            @Param("available") InventoryStatus available, @Param("expired") InventoryStatus expired,
            @Param("reserved") InventoryStatus reserved, @Param("active") ProductStatus active);
}
