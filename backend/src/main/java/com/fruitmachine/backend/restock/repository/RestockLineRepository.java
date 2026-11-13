package com.fruitmachine.backend.restock.repository;

import com.fruitmachine.backend.restock.entity.RestockLine;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RestockLineRepository extends JpaRepository<RestockLine, UUID> {
    @Query("select l from RestockLine l join fetch l.slot join fetch l.product where l.workOrderId = :workOrderId order by l.slot.slotCode, l.createdAt, l.id")
    List<RestockLine> findDetailsByWorkOrderId(@Param("workOrderId") UUID workOrderId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select l from RestockLine l where l.id = :id")
    Optional<RestockLine> findForUpdateById(@Param("id") UUID id);

    boolean existsByWorkOrderId(UUID workOrderId);

    boolean existsByWorkOrderIdAndSlotIdAndProductId(UUID workOrderId, UUID slotId, UUID productId);

    interface Totals {
        UUID getWorkOrderId(); Long getLines(); Long getPlanned(); Long getLoaded(); Long getVariance();
    }

    @Query(value = """
            SELECT work_order_id AS "workOrderId", count(*) AS "lines", sum(planned_quantity) AS "planned", sum(loaded_quantity) AS "loaded",
                   count(*) FILTER (WHERE loaded_quantity <> planned_quantity) AS "variance"
            FROM restock_lines WHERE work_order_id IN (:ids) GROUP BY work_order_id""", nativeQuery = true)
    List<Totals> totals(@Param("ids") Collection<UUID> workOrderIds);

    /** One row per load call: N LOAD rows of one transaction share line, batch, actor and created_at. */
    interface Load {
        UUID getLineId(); UUID getBatchId(); String getBatchCode(); Long getQuantity(); Instant getLoadedAt(); UUID getActorId(); String getActorName();
    }

    @Query(value = """
            SELECT t.reference_id AS "lineId", b.id AS "batchId", b.batch_code AS "batchCode", count(*) AS "quantity", t.created_at AS "loadedAt",
                   t.performed_by AS "actorId", u.full_name AS "actorName"
            FROM inventory_transactions t JOIN inventory_items i ON i.id = t.inventory_item_id JOIN product_batches b ON b.id = i.batch_id
            LEFT JOIN users u ON u.id = t.performed_by
            WHERE t.type = 'LOAD' AND t.reference_id IN (:lineIds)
            GROUP BY t.reference_id, b.id, b.batch_code, t.created_at, t.performed_by, u.full_name
            ORDER BY t.created_at, b.batch_code""", nativeQuery = true)
    List<Load> loads(@Param("lineIds") Collection<UUID> lineIds);
}
