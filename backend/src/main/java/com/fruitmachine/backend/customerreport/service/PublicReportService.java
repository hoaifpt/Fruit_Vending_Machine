package com.fruitmachine.backend.customerreport.service;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.customerreport.dto.PublicReportRequest;
import com.fruitmachine.backend.customerreport.dto.ReportFormResponse;
import com.fruitmachine.backend.customerreport.dto.ReportSubmittedResponse;
import com.fruitmachine.backend.customerreport.entity.CustomerReport;
import com.fruitmachine.backend.customerreport.entity.CustomerReportPhoto;
import com.fruitmachine.backend.customerreport.enums.ReportStatus;
import com.fruitmachine.backend.customerreport.enums.ReportType;
import com.fruitmachine.backend.customerreport.repository.CustomerReportPhotoRepository;
import com.fruitmachine.backend.customerreport.repository.CustomerReportRepository;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.workorder.entity.WorkOrder;
import com.fruitmachine.backend.workorder.enums.WorkOrderPriority;
import com.fruitmachine.backend.workorder.enums.WorkOrderSource;
import com.fruitmachine.backend.workorder.enums.WorkOrderStatus;
import com.fruitmachine.backend.workorder.enums.WorkOrderType;
import com.fruitmachine.backend.workorder.repository.WorkOrderRepository;
import com.fruitmachine.backend.workorder.service.WorkOrderService;
import jakarta.persistence.EntityManager;
import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * Public customer reports (issue #74, WF-02): no authentication; the machine comes from its report token. Every accepted submission
 * gets the same response shape, whatever the order state. Contact data never reaches work orders, notifications or logs.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PublicReportService {
    public static final String ACCEPTED_MESSAGE = "Đã ghi nhận phản ánh của bạn. Chúng tôi sẽ liên hệ nếu cần thêm thông tin.";
    static final Pattern ORDER_CODE = Pattern.compile("^ORD-\\d{8}-[0-9A-Z]{8}$");
    static final Pattern PHONE = Pattern.compile("^(0|\\+84)[0-9]{9,10}$");
    static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    private static final Pattern CONTROL = Pattern.compile("[\\p{Cc}&&[^\\n]]");
    private static final Pattern TOKEN = Pattern.compile("^[A-Za-z0-9_-]{22,32}$");
    private static final Duration DUE_AFTER = Duration.ofHours(24);

    private final EntityManager entityManager;
    private final CustomerReportRepository reports;
    private final CustomerReportPhotoRepository photos;
    private final ReportOrderVerifier verifier;
    private final ReportPhotoSanitizer sanitizer;
    private final ReportSupport support;
    private final WorkOrderService workOrderService;
    private final WorkOrderRepository workOrders;
    private final Clock clock;

    @Transactional(readOnly = true)
    public ReportFormResponse form(String token) {
        Machine machine = machineByToken(token);
        return new ReportFormResponse(machine.getName(), machine.getCode(), Arrays.asList(ReportType.values()), ReportPhotoSanitizer.MAX_PHOTOS,
                ReportPhotoSanitizer.MAX_BYTES);
    }

    @Transactional
    public ReportSubmittedResponse submit(String token, PublicReportRequest request, List<MultipartFile> files, String clientIp) {
        Machine machine = machineByToken(token);
        if (request == null) throw new BadRequestException("The report part is required");
        // Honeypot: bots fill every field. Pretend success, store nothing.
        if (request.website() != null && !request.website().isBlank()) {
            log.info("Customer report honeypot triggered for machine {}", machine.getCode());
            return new ReportSubmittedResponse(support.randomCode(), ACCEPTED_MESSAGE);
        }
        Input input = validate(request, files);

        ReportOrderVerifier.Result check = verifier.verify(machine.getId(), input.type(), input.orderCode());
        var report = new CustomerReport();
        report.setCode(support.newCode());
        report.setMachineId(machine.getId());
        report.setType(input.type());
        report.setDescription(input.description());
        report.setOrderCodeInput(input.orderCode());
        report.setOrderId(check.orderId());
        report.setBatchId(check.batchId());
        report.setVerdict(check.verdict());
        report.setContactName(input.contactName());
        report.setContactPhone(input.contactPhone());
        report.setContactEmail(input.contactEmail());
        report.setSourceIpHash(support.hashIp(clientIp));
        reports.saveAndFlush(report);
        for (ReportPhotoSanitizer.SanitizedPhoto photo : input.photos()) {
            var row = new CustomerReportPhoto();
            row.setReportId(report.getId());
            row.setContentType(photo.contentType());
            row.setSizeBytes(photo.data().length);
            row.setData(photo.data());
            photos.save(row);
        }
        photos.flush();
        attachWorkOrder(report, machine);
        reports.flush();
        log.info("Customer report {} ({}, {}) stored for machine {} with work order {}", report.getCode(), report.getType(), report.getVerdict(),
                machine.getCode(), report.getWorkOrderId());
        return new ReportSubmittedResponse(report.getCode(), ACCEPTED_MESSAGE);
    }

    /**
     * Same order already reported and still open -> its work order (status IN_REVIEW, no new notification). MACHINE_FAULT / OTHER
     * while an unfinished customer-report INCIDENT work order exists for the machine -> that one. Otherwise a new INCIDENT work
     * order, announced by the work order notifier to every WORK_ORDER_MANAGE holder.
     */
    private void attachWorkOrder(CustomerReport report, Machine machine) {
        if (report.getOrderId() != null) {
            Optional<CustomerReport> earlier = reports.findFirstByOrderIdAndStatusInAndWorkOrderIdNotNullOrderByCreatedAtAscIdAsc(report.getOrderId(),
                    ReportStatus.OPEN).filter(r -> !r.getId().equals(report.getId()));
            Optional<WorkOrder> open = earlier.flatMap(r -> workOrders.findForUpdateById(r.getWorkOrderId()))
                    .filter(w -> WorkOrderStatus.UNFINISHED.contains(w.getStatus()));
            if (open.isPresent()) {
                report.setStatus(ReportStatus.IN_REVIEW);
                join(report, open.get(), "Another customer report for the same order: " + report.getCode());
                return;
            }
        }
        if (report.getType() == ReportType.MACHINE_FAULT || report.getType() == ReportType.OTHER) {
            List<UUID> open = entityManager.createQuery("select w.id from WorkOrder w where w.machineId = :machine and w.type = :type"
                    + " and w.source = :source and w.status in (:unfinished) order by w.createdAt, w.id", UUID.class)
                    .setParameter("machine", machine.getId()).setParameter("type", WorkOrderType.INCIDENT).setParameter("source", WorkOrderSource.CUSTOMER_REPORT)
                    .setParameter("unfinished", WorkOrderStatus.UNFINISHED).setMaxResults(1).getResultList();
            Optional<WorkOrder> existing = open.stream().findFirst().flatMap(workOrders::findForUpdateById)
                    .filter(w -> WorkOrderStatus.UNFINISHED.contains(w.getStatus()));
            if (existing.isPresent()) {
                join(report, existing.get(), "New customer report " + report.getCode());
                return;
            }
        }
        WorkOrder created = workOrderService.createBySystem(WorkOrderType.INCIDENT, WorkOrderSource.CUSTOMER_REPORT, machine.getId(),
                "[" + report.getCode() + "] " + report.getType().label(), summary(report), priority(report.getType()),
                clock.instant().plus(DUE_AFTER), List.of());
        report.setWorkOrderId(created.getId());
    }

    private void join(CustomerReport report, WorkOrder workOrder, String note) {
        report.setWorkOrderId(workOrder.getId());
        workOrderService.recordSystemNote(workOrder, note, JsonNodeFactory.instance.objectNode().put("customerReportId", report.getId().toString())
                .put("reportCode", report.getCode()).put("type", report.getType().name()).put("verdict", report.getVerdict().name()));
    }

    /** What happened, never who reported it (no contact data). */
    private static String summary(CustomerReport report) {
        var text = new StringBuilder("Customer report ").append(report.getCode()).append(" (").append(report.getType().name()).append(")");
        if (report.getOrderCodeInput() != null) text.append("\nOrder: ").append(report.getOrderCodeInput()).append(" -> ").append(report.getVerdict().name());
        if (report.getDescription() != null) text.append("\n").append(report.getDescription());
        return text.length() > 2000 ? text.substring(0, 2000) : text.toString();
    }

    private static WorkOrderPriority priority(ReportType type) {
        return switch (type) {
            case PAID_NOT_RECEIVED, MACHINE_FAULT -> WorkOrderPriority.HIGH;
            case PRODUCT_QUALITY -> WorkOrderPriority.NORMAL;
            case OTHER -> WorkOrderPriority.LOW;
        };
    }

    private Machine machineByToken(String token) {
        if (token == null || !TOKEN.matcher(token).matches()) throw notFound();
        List<Machine> found = entityManager.createQuery("select m from Machine m where m.reportToken = :token", Machine.class)
                .setParameter("token", token).getResultList();
        if (found.isEmpty() || found.getFirst().getStatus() == MachineStatus.INACTIVE) throw notFound();
        return found.getFirst();
    }

    private static ResourceNotFoundException notFound() {
        return new ResourceNotFoundException("Report form not found");
    }

    record Input(ReportType type, String orderCode, String description, String contactName, String contactPhone, String contactEmail,
            List<ReportPhotoSanitizer.SanitizedPhoto> photos) {
    }

    private Input validate(PublicReportRequest request, List<MultipartFile> files) {
        if (request.type() == null) throw invalid("type", "type is required");
        if (!Boolean.TRUE.equals(request.consent())) throw invalid("consent", "consent must be true");
        String orderCode = clean(request.orderCode(), 64);
        if (orderCode != null) {
            orderCode = orderCode.toUpperCase(Locale.ROOT);
            if (!ORDER_CODE.matcher(orderCode).matches()) throw invalid("orderCode", "orderCode must look like ORD-yyyyMMdd-XXXXXXXX");
        }
        if (request.type() == ReportType.PAID_NOT_RECEIVED && orderCode == null) throw invalid("orderCode", "orderCode is required for PAID_NOT_RECEIVED");
        String description = clean(request.description(), Integer.MAX_VALUE);
        if (description != null && description.length() > 1000) throw invalid("description", "description must be at most 1000 characters");
        if (request.type() != ReportType.PAID_NOT_RECEIVED && description == null) throw invalid("description", "description is required");
        String name = clean(request.contactName(), Integer.MAX_VALUE);
        if (name != null && name.length() > 100) throw invalid("contactName", "contactName must be at most 100 characters");
        String phone = clean(request.contactPhone(), Integer.MAX_VALUE);
        if (phone != null && !PHONE.matcher(phone).matches()) throw invalid("contactPhone", "contactPhone must be a Vietnamese phone number");
        String email = clean(request.contactEmail(), Integer.MAX_VALUE);
        if (email != null && (email.length() > 254 || !EMAIL.matcher(email).matches())) throw invalid("contactEmail", "contactEmail is not a valid e-mail address");
        if (request.type().needsContact() && phone == null && email == null)
            throw invalid("contact", "contactPhone or contactEmail is required for " + request.type());

        List<MultipartFile> uploads = files == null ? List.of() : files.stream().filter(f -> f != null && !f.isEmpty()).toList();
        if (uploads.size() > ReportPhotoSanitizer.MAX_PHOTOS) throw invalid("photos", "at most 3 photos");
        List<ReportPhotoSanitizer.SanitizedPhoto> sanitized = new ArrayList<>();
        for (MultipartFile upload : uploads) {
            if (upload.getSize() > ReportPhotoSanitizer.MAX_BYTES) throw invalid("photos", "a photo is larger than 2 MB");
            try {
                sanitized.add(sanitizer.sanitize(upload.getBytes()));
            } catch (IOException ex) {
                throw invalid("photos", "a photo could not be read");
            }
        }
        return new Input(request.type(), orderCode, description, name, phone, email, sanitized);
    }

    /** Strips, removes control characters (newlines kept), empty -> null. */
    private static String clean(String value, int hardLimit) {
        if (value == null) return null;
        String cleaned = CONTROL.matcher(value).replaceAll("").strip();
        if (cleaned.isEmpty()) return null;
        return cleaned.length() > hardLimit ? cleaned.substring(0, hardLimit) : cleaned;
    }

    private static BadRequestException invalid(String field, String message) {
        return new BadRequestException("Request validation failed", java.util.Map.of(field, message));
    }
}
