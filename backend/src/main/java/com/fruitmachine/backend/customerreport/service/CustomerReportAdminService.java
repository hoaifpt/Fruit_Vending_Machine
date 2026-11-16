package com.fruitmachine.backend.customerreport.service;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.common.time.BusinessCalendar;
import com.fruitmachine.backend.customerreport.dto.*;
import com.fruitmachine.backend.customerreport.entity.CustomerReport;
import com.fruitmachine.backend.customerreport.entity.CustomerReportPhoto;
import com.fruitmachine.backend.customerreport.enums.ReportResolution;
import com.fruitmachine.backend.customerreport.enums.ReportStatus;
import com.fruitmachine.backend.customerreport.enums.ReportType;
import com.fruitmachine.backend.customerreport.enums.ReportVerdict;
import com.fruitmachine.backend.customerreport.repository.CustomerReportPhotoRepository;
import com.fruitmachine.backend.customerreport.repository.CustomerReportRepository;
import com.fruitmachine.backend.order.enums.OrderStatus;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.user.entity.User;
import jakarta.persistence.EntityManager;
import jakarta.persistence.criteria.JoinType;
import jakarta.validation.Valid;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;

/**
 * Administrator side of customer reports (issue #74 §5). Holders of CUSTOMER_REPORT_MANAGE see every report with full contact data;
 * others (STAFF) see only reports linked to work orders assigned to them, contact masked, and any other report is 404.
 */
@Service
@Validated
@RequiredArgsConstructor
public class CustomerReportAdminService {
    public static final String FINAL = "REPORT_ALREADY_CLOSED";
    public static final String NOT_NEW = "REPORT_NOT_NEW";
    public static final String AUDIT_REVIEWED = "CUSTOMER_REPORT_REVIEWED";
    public static final String AUDIT_RESOLVED = "CUSTOMER_REPORT_RESOLVED";
    public static final String AUDIT_REJECTED = "CUSTOMER_REPORT_REJECTED";
    private static final int MAX_PAGE_SIZE = 100;

    private final CustomerReportRepository reports;
    private final CustomerReportPhotoRepository photos;
    private final EntityManager entityManager;
    private final BusinessCalendar calendar;
    private final ReportAudit audit;
    private final Clock clock;

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_CUSTOMER_REPORT_READ)
    public CustomerReportPageResponse list(ReportStatus status, ReportType type, ReportVerdict verdict, UUID machineId, LocalDate from, LocalDate to,
            Boolean hasOrder, int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) throw new BadRequestException("page must be >= 0 and size 1..100");
        if (from != null && to != null && to.isBefore(from)) throw new BadRequestException("to must not be before from");
        List<Specification<CustomerReport>> filters = new ArrayList<>();
        if (status != null) filters.add((r, q, cb) -> cb.equal(r.get("status"), status));
        if (type != null) filters.add((r, q, cb) -> cb.equal(r.get("type"), type));
        if (verdict != null) filters.add((r, q, cb) -> cb.equal(r.get("verdict"), verdict));
        if (machineId != null) filters.add((r, q, cb) -> cb.equal(r.get("machineId"), machineId));
        if (from != null) filters.add((r, q, cb) -> cb.greaterThanOrEqualTo(r.get("createdAt"), calendar.dayStart(from)));
        if (to != null) filters.add((r, q, cb) -> cb.lessThan(r.get("createdAt"), calendar.dayEnd(to)));
        if (hasOrder != null) filters.add((r, q, cb) -> hasOrder ? cb.isNotNull(r.get("orderId")) : cb.isNull(r.get("orderId")));
        if (!manager()) {
            UUID me = ReportAudit.actorId();
            filters.add((r, q, cb) -> cb.equal(r.join("workOrder", JoinType.INNER).get("assignee").get("id"), me));
        }
        var result = reports.findAll(Specification.allOf(filters),
                PageRequest.of(page, size, Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))));
        boolean full = false; // lists always mask contact data
        var content = result.getContent().stream().map(r -> new CustomerReportSummaryResponse(r.getId(), r.getCode(), r.getType(), r.getStatus(),
                r.getVerdict(), r.getMachineId(), r.getMachine().getCode(), r.getOrderCodeInput(), r.getOrderId(), ReportSupport.contact(r, full),
                workOrder(r), r.getResolution(), r.getCreatedAt(), r.getResolvedAt())).toList();
        return new CustomerReportPageResponse(content, page, size, result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_CUSTOMER_REPORT_READ)
    public CustomerReportDetailResponse get(UUID id) {
        return detail(visible(id));
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_CUSTOMER_REPORT_READ)
    public CustomerReportPhoto photo(UUID id, UUID photoId) {
        visible(id);
        return photos.findByIdAndReportId(photoId, id).orElseThrow(() -> new ResourceNotFoundException("Photo not found"));
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_CUSTOMER_REPORT_MANAGE)
    public CustomerReportDetailResponse review(UUID id) {
        CustomerReport report = lock(id);
        requireOpen(report);
        if (report.getStatus() != ReportStatus.NEW) throw conflict(NOT_NEW, "only a NEW report can be taken into review");
        ReportStatus before = report.getStatus();
        report.setStatus(ReportStatus.IN_REVIEW);
        reports.flush();
        audit.write(AUDIT_REVIEWED, "CustomerReport", report.getId(), state(before, null), state(report.getStatus(), null));
        return reload(id);
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_CUSTOMER_REPORT_MANAGE)
    public CustomerReportDetailResponse resolve(UUID id, @Valid ReportDecisionRequest request) {
        return close(id, request, ReportResolution.RESOLVE, ReportStatus.RESOLVED, AUDIT_RESOLVED);
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_CUSTOMER_REPORT_MANAGE)
    public CustomerReportDetailResponse reject(UUID id, @Valid ReportDecisionRequest request) {
        return close(id, request, ReportResolution.REJECT, ReportStatus.REJECTED, AUDIT_REJECTED);
    }

    /** Issue #72 link: a recorded refund closes the open reports of that order as REFUNDED by the refunding administrator. */
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public int closeForRefund(UUID orderId, User actor, String note) {
        int closed = 0;
        for (CustomerReport report : reports.findForUpdateByOrderIdAndStatusIn(orderId, ReportStatus.OPEN)) {
            ReportStatus before = report.getStatus();
            apply(report, ReportStatus.RESOLVED, ReportResolution.REFUNDED, note, actor);
            audit.write(actor, AUDIT_RESOLVED, "CustomerReport", report.getId(), state(before, null), state(report.getStatus(), ReportResolution.REFUNDED));
            closed++;
        }
        reports.flush();
        return closed;
    }

    private CustomerReportDetailResponse close(UUID id, ReportDecisionRequest request, Set<ReportResolution> allowed, ReportStatus target, String action) {
        if (!allowed.contains(request.resolution()))
            throw new BadRequestException("resolution must be one of " + allowed.stream().map(Enum::name).sorted().toList());
        CustomerReport report = lock(id);
        requireOpen(report);
        ReportStatus before = report.getStatus();
        apply(report, target, request.resolution(), request.note(), audit.actor());
        reports.flush();
        audit.write(action, "CustomerReport", report.getId(), state(before, null), state(target, request.resolution()));
        return reload(id);
    }

    private void apply(CustomerReport report, ReportStatus target, ReportResolution resolution, String note, User actor) {
        report.setStatus(target);
        report.setResolution(resolution);
        report.setResolutionNote(note);
        report.setResolvedBy(actor);
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        report.setResolvedAt(report.getCreatedAt() != null && now.isBefore(report.getCreatedAt()) ? report.getCreatedAt() : now);
    }

    private CustomerReport lock(UUID id) {
        return reports.findForUpdateById(id).orElseThrow(CustomerReportAdminService::missing);
    }

    private static void requireOpen(CustomerReport report) {
        if (!report.getStatus().open()) throw conflict(FINAL, "the report is already " + report.getStatus());
    }

    private CustomerReportDetailResponse reload(UUID id) {
        entityManager.flush();
        entityManager.clear();
        return detail(reports.findDetailsById(id).orElseThrow());
    }

    private CustomerReport visible(UUID id) {
        CustomerReport report = reports.findDetailsById(id).orElseThrow(CustomerReportAdminService::missing);
        if (manager()) return report;
        var workOrder = report.getWorkOrder();
        if (workOrder == null || workOrder.getAssignee() == null || !workOrder.getAssignee().getId().equals(ReportAudit.actorId())) throw missing();
        return report;
    }

    private CustomerReportDetailResponse detail(CustomerReport report) {
        ReportOrderResponse order = null;
        if (report.getOrderId() != null) {
            Object[] row = entityManager.createQuery("select o.orderCode, o.status from Order o where o.id = :id", Object[].class)
                    .setParameter("id", report.getOrderId()).getSingleResult();
            order = new ReportOrderResponse(report.getOrderId(), (String) row[0], (OrderStatus) row[1]);
        }
        ReportBatchResponse batch = null;
        if (report.getBatchId() != null) {
            Object[] row = entityManager.createQuery("select b.batchCode, p.name, b.expiresAt from ProductBatch b join b.product p where b.id = :id", Object[].class)
                    .setParameter("id", report.getBatchId()).getSingleResult();
            batch = new ReportBatchResponse(report.getBatchId(), (String) row[0], (String) row[1], (Instant) row[2]);
        }
        var photoList = photos.findInfoByReportId(report.getId()).stream()
                .map(p -> new ReportPhotoResponse(p.getId(), p.getContentType(), p.getSizeBytes())).toList();
        var by = report.getResolvedBy();
        var machine = report.getMachine();
        return new CustomerReportDetailResponse(report.getId(), report.getCode(), report.getType(), report.getStatus(), report.getVerdict(),
                report.getMachineId(), machine.getCode(), machine.getName(), report.getDescription(), report.getOrderCodeInput(), order, batch,
                ReportSupport.contact(report, manager()), photoList, workOrder(report), report.getResolution(), report.getResolutionNote(),
                by == null ? null : new ReportActorResponse(by.getId(), by.getFullName()), report.getResolvedAt(), report.getCreatedAt(), report.getUpdatedAt());
    }

    private static ReportWorkOrderResponse workOrder(CustomerReport report) {
        var w = report.getWorkOrder();
        return w == null ? null : new ReportWorkOrderResponse(w.getId(), w.getCode(), w.getStatus());
    }

    private static ObjectNode state(ReportStatus status, ReportResolution resolution) {
        ObjectNode node = JsonNodeFactory.instance.objectNode().put("status", status.name());
        if (resolution != null) node.put("resolution", resolution.name());
        return node;
    }

    private static boolean manager() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null && authentication.getAuthorities().stream()
                .anyMatch(a -> Permissions.CUSTOMER_REPORT_MANAGE.equals(a.getAuthority()));
    }

    private static ResourceNotFoundException missing() {
        return new ResourceNotFoundException("Customer report not found");
    }

    private static ConflictException conflict(String code, String message) {
        return new ConflictException(code + ": " + message);
    }
}
