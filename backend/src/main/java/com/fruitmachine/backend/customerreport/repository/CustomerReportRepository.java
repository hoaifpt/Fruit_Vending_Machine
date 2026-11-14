package com.fruitmachine.backend.customerreport.repository;

import com.fruitmachine.backend.customerreport.entity.CustomerReport;
import com.fruitmachine.backend.customerreport.enums.ReportStatus;
import jakarta.persistence.LockModeType;
import java.util.Collection;
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

public interface CustomerReportRepository extends JpaRepository<CustomerReport, UUID>, JpaSpecificationExecutor<CustomerReport> {
    boolean existsByCode(String code);

    /** To-one graph only, so paging stays in the database. */
    @Override
    @EntityGraph(attributePaths = {"machine", "workOrder"})
    Page<CustomerReport> findAll(Specification<CustomerReport> specification, Pageable pageable);

    @EntityGraph(attributePaths = {"machine", "workOrder", "workOrder.assignee", "resolvedBy"})
    Optional<CustomerReport> findDetailsById(UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from CustomerReport r where r.id = :id")
    Optional<CustomerReport> findForUpdateById(@Param("id") UUID id);

    /** The oldest open report of the order that already has a work order (later reports of the same order join it). */
    Optional<CustomerReport> findFirstByOrderIdAndStatusInAndWorkOrderIdNotNullOrderByCreatedAtAscIdAsc(UUID orderId, Collection<ReportStatus> statuses);

    /** Open reports of an order, locked; a recorded refund closes them. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from CustomerReport r where r.orderId = :orderId and r.status in :statuses order by r.id")
    List<CustomerReport> findForUpdateByOrderIdAndStatusIn(@Param("orderId") UUID orderId, @Param("statuses") Collection<ReportStatus> statuses);

    interface LinkedReport {
        UUID getWorkOrderId();

        UUID getId();

        String getCode();

        String getType();

        String getVerdict();

        String getStatus();
    }

    /** Reports of a page of work orders, one query (work order responses). */
    @Query(value = "SELECT work_order_id AS workOrderId, id, code, type, verdict, status FROM customer_reports"
            + " WHERE work_order_id IN (:ids) ORDER BY created_at, id", nativeQuery = true)
    List<LinkedReport> findLinked(@Param("ids") Collection<UUID> workOrderIds);
}
