package com.fruitmachine.backend.order.repository;

import com.fruitmachine.backend.order.entity.OrderItemAllocation;
import com.fruitmachine.backend.order.enums.AllocationStatus;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OrderItemAllocationRepository extends JpaRepository<OrderItemAllocation, UUID> {
    /** Sorted by inventory item so every release locks items in one global order. */
    @Query("select a from OrderItemAllocation a where a.orderItem.order.id = :orderId and a.status = :status order by a.inventoryItem.id")
    List<OrderItemAllocation> findByOrderIdAndStatus(@Param("orderId") UUID orderId, @Param("status") AllocationStatus status);

    @Query("""
            select a from OrderItemAllocation a join fetch a.orderItem oi join fetch a.inventoryItem i
            join fetch i.batch left join fetch i.slot
            where oi.order.id = :orderId order by a.createdAt, a.id
            """)
    List<OrderItemAllocation> findDetailsByOrderId(@Param("orderId") UUID orderId);
}
