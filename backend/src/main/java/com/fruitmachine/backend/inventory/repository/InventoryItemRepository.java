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
    interface CatalogRow {
        UUID getProductId(); String getSku(); String getName(); String getDescription();
        java.math.BigDecimal getPrice(); String getImageUrl(); Long getAvailableQuantity();
    }
    /** Single grouped aggregate of sellable bowls per product; nothing is counted in Java. */
    @Query("""
        select p.id as productId, p.sku as sku, p.name as name, p.description as description, p.price as price,
               p.imageUrl as imageUrl, count(i) as availableQuantity
        from InventoryItem i join i.batch b join b.product p join i.slot s
        where s.machine.id = :machineId and s.status = :slotStatus and i.status = :itemStatus
          and p.status = :productStatus and b.expiresAt > :holdDeadline
        group by p.id, p.sku, p.name, p.description, p.price, p.imageUrl
        order by p.name, p.id
        """)
    List<CatalogRow> findCatalog(@Param("machineId") UUID machineId, @Param("holdDeadline") Instant holdDeadline,
            @Param("slotStatus") com.fruitmachine.backend.machine.enums.SlotStatus slotStatus,
            @Param("itemStatus") InventoryStatus itemStatus, @Param("productStatus") ProductStatus productStatus);

    /**
     * FEFO reservation candidates for one product on one machine. SKIP LOCKED means concurrent orders never
     * wait for or share a bowl; the batch must outlive the hold deadline so a bowl cannot expire while unpaid.
     */
    @Query(value = """
        select i.* from inventory_items i
        join product_batches b on b.id = i.batch_id
        join machine_slots s on s.id = i.slot_id
        where b.product_id = :productId and s.machine_id = :machineId and s.status = 'ACTIVE'
          and i.status = 'AVAILABLE' and b.expires_at > :holdDeadline
        order by b.expires_at, i.loaded_at, i.id
        limit :quantity
        for update of i skip locked
        """, nativeQuery = true)
    List<InventoryItem> findReservationCandidates(@Param("machineId") UUID machineId, @Param("productId") UUID productId,
            @Param("holdDeadline") Instant holdDeadline, @Param("quantity") int quantity);

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
