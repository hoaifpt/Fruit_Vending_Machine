package com.fruitmachine.backend.payment.repository;

import com.fruitmachine.backend.payment.entity.Payment;
import com.fruitmachine.backend.payment.enums.PaymentStatus;
import jakarta.persistence.LockModeType;
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

public interface PaymentRepository extends JpaRepository<Payment, UUID>, JpaSpecificationExecutor<Payment> {
    /** Every attempt of an order, locked in id order. Callers hold the order lock first (Order, Payment, InventoryItem). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Payment p where p.order.id = :orderId order by p.id")
    List<Payment> findForUpdateByOrderId(@Param("orderId") UUID orderId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Payment p where p.order.id = :orderId and p.status = :status order by p.id")
    List<Payment> findForUpdateByOrderIdAndStatus(@Param("orderId") UUID orderId, @Param("status") PaymentStatus status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Payment p where p.id = :id and p.order.id = :orderId")
    Optional<Payment> findForUpdateByIdAndOrderId(@Param("id") UUID id, @Param("orderId") UUID orderId);

    Optional<Payment> findTopByOrderIdOrderByCreatedAtDescIdDesc(UUID orderId);

    List<Payment> findByOrderIdOrderByCreatedAtAscIdAsc(UUID orderId);

    boolean existsByProviderAndPaymentReference(String provider, String paymentReference);

    /** To-one graph only, so paging stays in the database. */
    @Override
    @EntityGraph(attributePaths = {"order", "order.machine"})
    Page<Payment> findAll(Specification<Payment> specification, Pageable pageable);

    @EntityGraph(attributePaths = {"order", "order.machine"})
    Optional<Payment> findWithOrderById(UUID id);
}
