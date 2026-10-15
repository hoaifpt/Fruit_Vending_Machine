package com.fruitmachine.backend.order.repository;

import com.fruitmachine.backend.order.entity.OrderItem;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OrderItemRepository extends JpaRepository<OrderItem, UUID> {
    interface LineCount {
        UUID getOrderId();

        Long getLines();
    }

    /** One grouped query for a page of orders; avoids a collection fetch or N+1. */
    @Query("select oi.order.id as orderId, count(oi) as lines from OrderItem oi where oi.order.id in :orderIds group by oi.order.id")
    List<LineCount> countLines(@Param("orderIds") Collection<UUID> orderIds);
}
