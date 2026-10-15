package com.fruitmachine.backend.order.repository;

import com.fruitmachine.backend.order.entity.Order;
import com.fruitmachine.backend.order.enums.OrderStatus;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OrderRepository extends JpaRepository<Order, UUID>, JpaSpecificationExecutor<Order> {
    boolean existsByOrderCode(String orderCode);

    /** To-one graph only: collections are never fetched while paging. */
    @Override
    @EntityGraph(attributePaths = {"machine"})
    Page<Order> findAll(Specification<Order> specification, Pageable pageable);

    @EntityGraph(attributePaths = {"machine", "items", "items.product"})
    Optional<Order> findWithDetailsById(UUID id);

    @EntityGraph(attributePaths = {"items", "items.product"})
    Optional<Order> findWithItemsByIdAndMachineId(UUID id, UUID machineId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select o from Order o where o.id = :id")
    Optional<Order> findForUpdateById(@Param("id") UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select o from Order o where o.id = :id and o.machine.id = :machineId")
    Optional<Order> findForUpdateByIdAndMachineId(@Param("id") UUID id, @Param("machineId") UUID machineId);

    @Query("select o.id from Order o where o.status = :status and o.expiresAt <= :now order by o.expiresAt, o.id")
    List<UUID> findExpiredIds(@Param("status") OrderStatus status, @Param("now") Instant now, Pageable limit);
}
