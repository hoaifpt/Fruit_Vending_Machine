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
    /**
     * Products that can be dispensed now, as one aggregate statement (nothing is counted in Java). A slot's head is its
     * physically present bowl (AVAILABLE, RESERVED, EXPIRED, DISPENSE_FAILED) with the earliest loaded_at, tie-break id;
     * a slot sells a product only when that head is an AVAILABLE bowl of the product outliving the hold deadline in an
     * ACTIVE slot. availableQuantity counts AVAILABLE, unexpired bowls of the product in exactly those slots.
     */
    @Query(value = """
        with heads as (
            select distinct on (i.slot_id) i.slot_id, i.status, i.batch_id
            from inventory_items i join machine_slots s on s.id = i.slot_id
            where s.machine_id = :machineId and i.status in ('AVAILABLE', 'RESERVED', 'EXPIRED', 'DISPENSE_FAILED')
            order by i.slot_id, i.loaded_at, i.id
        ), sellable as (
            select h.slot_id, hb.product_id
            from heads h join product_batches hb on hb.id = h.batch_id join machine_slots s on s.id = h.slot_id
            where h.status = 'AVAILABLE' and hb.expires_at > :holdDeadline and s.status = 'ACTIVE'
        )
        select p.id as "productId", p.sku as "sku", p.name as "name", p.description as "description", p.price as "price",
               p.image_url as "imageUrl", count(i.id) as "availableQuantity"
        from sellable x
        join products p on p.id = x.product_id
        join inventory_items i on i.slot_id = x.slot_id and i.status = 'AVAILABLE'
        join product_batches b on b.id = i.batch_id and b.product_id = x.product_id and b.expires_at > :holdDeadline
        where p.status = 'ACTIVE'
        group by p.id, p.sku, p.name, p.description, p.price, p.image_url
        order by p.name, p.id
        """, nativeQuery = true)
    List<CatalogRow> findCatalog(@Param("machineId") UUID machineId, @Param("holdDeadline") Instant holdDeadline);

    /**
     * Slots of the machine that physically hold at least one bowl of the product (any present status). Unlocked
     * discovery only: the caller locks these slots and recomputes their heads under the lock.
     */
    @Query(value = """
        select distinct i.slot_id from inventory_items i
        join product_batches b on b.id = i.batch_id
        join machine_slots s on s.id = i.slot_id
        where s.machine_id = :machineId and b.product_id = :productId
          and i.status in ('AVAILABLE', 'RESERVED', 'EXPIRED', 'DISPENSE_FAILED')
        """, nativeQuery = true)
    List<UUID> findSlotIdsHoldingProduct(@Param("machineId") UUID machineId, @Param("productId") UUID productId);

    /**
     * The sellable head to reserve among the given (already locked) slots: per slot the earliest-loaded present bowl
     * (tie-break id), kept only if it is an AVAILABLE bowl of the product that outlives the hold deadline in an ACTIVE
     * slot of the machine. FEFO applies between heads only: head expiry, head loaded_at, slot_code, slot id.
     */
    @Query(value = """
        select h.id from (
            select distinct on (i.slot_id) i.id, i.slot_id, i.status, i.loaded_at, i.batch_id
            from inventory_items i
            where i.slot_id in (:slotIds) and i.status in ('AVAILABLE', 'RESERVED', 'EXPIRED', 'DISPENSE_FAILED')
            order by i.slot_id, i.loaded_at, i.id
        ) h
        join product_batches b on b.id = h.batch_id
        join machine_slots s on s.id = h.slot_id
        where h.status = 'AVAILABLE' and b.product_id = :productId and b.expires_at > :holdDeadline
          and s.status = 'ACTIVE' and s.machine_id = :machineId
        order by b.expires_at, h.loaded_at, s.slot_code, s.id
        limit 1
        """, nativeQuery = true)
    Optional<UUID> findSellableHeadId(@Param("machineId") UUID machineId, @Param("productId") UUID productId,
            @Param("slotIds") Collection<UUID> slotIds, @Param("holdDeadline") Instant holdDeadline);

    /** Present bowls of a slot in dispensing order; the first one is the head. */
    @Query("""
        select i from InventoryItem i join fetch i.batch
        where i.slotId = :slotId and i.status in :physical
        order by i.loadedAt, i.id
        """)
    List<InventoryItem> findHeadCandidates(@Param("slotId") UUID slotId, @Param("physical") Collection<InventoryStatus> physical, Pageable pageable);

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
