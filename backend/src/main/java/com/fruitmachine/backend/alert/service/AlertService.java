package com.fruitmachine.backend.alert.service;

import com.fruitmachine.backend.workorder.repository.WorkOrderAlertRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.alert.dto.AlertPageResponse;
import com.fruitmachine.backend.alert.dto.AlertResponse;
import com.fruitmachine.backend.alert.entity.Alert;
import com.fruitmachine.backend.alert.enums.AlertSeverity;
import com.fruitmachine.backend.alert.enums.AlertStatus;
import com.fruitmachine.backend.alert.enums.AlertType;
import com.fruitmachine.backend.alert.event.AlertRaisedEvent;
import com.fruitmachine.backend.alert.repository.AlertRepository;
import com.fruitmachine.backend.alert.repository.AlertWriter;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.common.request.TimeRange;
import com.fruitmachine.backend.dispense.event.DispenseFailedEvent;
import com.fruitmachine.backend.dispense.event.DispenseMultipleBowlsEvent;
import com.fruitmachine.backend.machine.entity.MachineSlot;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.machine.repository.MachineSlotRepository;
import com.fruitmachine.backend.machine.service.MachineService;
import com.fruitmachine.backend.mqtt.contract.MachineErrorCode;
import com.fruitmachine.backend.mqtt.contract.MachineEventType;
import com.fruitmachine.backend.security.permission.Permissions;
import com.fruitmachine.backend.security.user.AuthenticatedUser;
import com.fruitmachine.backend.user.repository.UserRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Alerts (issue #58): one unresolved alert per problem (dedupe key), raised by the health check, dispense events and machine
 * faults, resolved by the system when the condition clears or by staff. A newly inserted alert publishes AlertRaisedEvent, so
 * users with ALERT_NOTIFY get one notification after commit; a de-duplicated repeat and an auto-resolve notify nobody.
 * Machine protection (MAINTENANCE) is applied when the alert is created, through MachineService.enterMaintenanceBySystem.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AlertService {
    public static final int MAX_PAGE_SIZE = 200;
    public static final String UNKNOWN_FAULT = "UNKNOWN_FAULT";
    public static final String MULTIPLE_BOWLS = MachineErrorCode.Reason.MULTIPLE_BOWLS_DETECTED.name();
    static final Pattern ERROR_CODE = Pattern.compile("^[A-Z][A-Z0-9_]{1,63}$");
    /** Faults that make sales unsafe or unconfirmable: the machine goes to MAINTENANCE (contract §6.2, issue #58 §3). */
    static final Set<String> MAINTENANCE_FAULTS = Set.of(MachineErrorCode.Fault.SERVO_INIT_FAILED.name(), MachineErrorCode.Fault.GATE_POSITION_UNKNOWN.name(),
            MachineErrorCode.Fault.CONTROLLER_FAULT.name(), MachineErrorCode.Fault.IR_SENSOR_STUCK.name(), MachineErrorCode.Fault.IR_SENSOR_DISCONNECTED.name());
    static final Set<String> BAD_RESET_REASONS = Set.of(MachineErrorCode.ResetReason.WATCHDOG.name(), MachineErrorCode.ResetReason.PANIC.name(),
            MachineErrorCode.ResetReason.BROWNOUT.name());
    private static final Set<AlertStatus> UNRESOLVED = EnumSet.of(AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED);

    private final AlertWriter writer;
    private final AlertRepository alerts;
    private final MachineRepository machines;
    private final MachineSlotRepository slots;
    private final MachineService machineService;
    private final UserRepository users;
    private final ApplicationEventPublisher events;
    private final Clock clock;
    private final WorkOrderAlertRepository workOrderLinks;

    // ---- system side ----

    /** Inserts the alert unless an unresolved one with the same key exists. @return true when a new alert was created */
    @Transactional
    public boolean raise(AlertSpec spec, Instant now) {
        var id = writer.insertIfAbsent(spec, now);
        id.ifPresent(alertId -> {
            log.info("Alert {} {} raised for machine {} ({})", spec.type(), spec.errorCode() == null ? "" : spec.errorCode(), spec.machineId(), spec.dedupeKey());
            events.publishEvent(new AlertRaisedEvent(alertId));
        });
        return id.isPresent();
    }

    /** The condition is gone: OPEN/ACKNOWLEDGED -> RESOLVED by the system, without a notification. */
    @Transactional
    public boolean autoResolve(String dedupeKey, Instant now) {
        boolean resolved = writer.resolveBySystem(dedupeKey, now);
        if (resolved) log.info("Alert {} resolved by the system: condition cleared", dedupeKey);
        return resolved;
    }

    /** Raises the alert and, when it is new and the problem makes selling unsafe, puts the machine in MAINTENANCE. */
    @Transactional
    public boolean raiseProtecting(AlertSpec spec, boolean maintenance, Instant now) {
        boolean created = raise(spec, now);
        if (created && maintenance) machineService.enterMaintenanceBySystem(spec.machineId(), spec.errorCode() == null ? spec.type().name() : spec.errorCode());
        return created;
    }

    /** Dispense failure (#52), after its transaction committed: CRITICAL when the outcome is unknown, WARNING when the bowl came back. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void onDispenseFailed(DispenseFailedEvent event) {
        String machineCode = machineCode(event.machineId());
        String slotCode = slots.findById(event.slotId()).map(MachineSlot::getSlotCode).orElse("?");
        raise(new AlertSpec(AlertType.DISPENSE_FAILED, event.bowlReturned() ? AlertSeverity.WARNING : AlertSeverity.CRITICAL, event.machineId(),
                event.slotId(), errorCode(event.reason()), AlertSpec.dispenseKey(event.commandId()), AlertTemplates.title(AlertType.DISPENSE_FAILED, null),
                AlertTemplates.dispenseFailed(machineCode, slotCode, event.commandCode(), event.reason(), event.bowlReturned())), now());
    }

    /** The machine reported success after all: the dispense alert of that command is resolved by the system. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void onDispenseLateSuccess(UUID commandId) {
        autoResolve(AlertSpec.dispenseKey(commandId), now());
    }

    /** Several bowls for one command (#52): CRITICAL hardware fault; the machine is already in MAINTENANCE. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void onMultipleBowls(DispenseMultipleBowlsEvent event) {
        raise(hardwareSpec(event.machineId(), machineCode(event.machineId()), MULTIPLE_BOWLS, AlertSeverity.CRITICAL, false), now());
    }

    /**
     * Machine events FAULT, BOOT and FAULT_CLEARED (contract §4.2, §6.2, §6.3), routed by MachineMessageHandler after the history
     * recorded them. Other event types are ignored here.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void onMachineEvent(UUID machineId, String machineCode, String eventType, JsonNode details, Instant now) {
        switch (eventType) {
            case MachineEventType.FAULT -> {
                JsonNode reported = details.path(MachineEventType.CODE_FIELD);
                String code = reported.isTextual() && ERROR_CODE.matcher(reported.asText()).matches() ? reported.asText() : UNKNOWN_FAULT;
                AlertSeverity severity = known(code) ? AlertSeverity.valueOf(MachineErrorCode.Fault.valueOf(code).severity().name()) : AlertSeverity.WARNING;
                boolean maintenance = MAINTENANCE_FAULTS.contains(code);
                raiseProtecting(hardwareSpec(machineId, machineCode, code, severity, maintenance), maintenance, now);
            }
            case MachineEventType.BOOT -> {
                String reason = details.path(MachineEventType.RESET_REASON_FIELD).asText("");
                if (BAD_RESET_REASONS.contains(reason)) {
                    raise(hardwareSpec(machineId, machineCode, "REBOOT_" + reason, AlertSeverity.WARNING, false), now);
                }
            }
            case MachineEventType.FAULT_CLEARED -> autoResolve(AlertSpec.hardwareKey(machineId, MachineErrorCode.Fault.CONTROLLER_FAULT.name()), now);
            default -> { }
        }
    }

    // ---- staff side ----

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_ALERT_READ)
    public AlertPageResponse search(AlertStatus status, AlertType type, AlertSeverity severity, UUID machineId, UUID slotId, String errorCode,
            Instant from, Instant to, int page, int size) {
        TimeRange.checkPage(page, size, MAX_PAGE_SIZE);
        TimeRange range = TimeRange.of(from, to);
        var result = alerts.search(status == null ? UNRESOLVED : Set.of(status), type, severity, machineId, slotId,
                errorCode == null || errorCode.isBlank() ? null : errorCode.strip(), range.from(), range.to(), PageRequest.of(page, size));
        return new AlertPageResponse(responses(result.getContent()), page, size,
                result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_ALERT_READ)
    public AlertResponse get(UUID id) {
        return response(alerts.findDetailsById(id).orElseThrow(AlertService::missing));
    }

    /** OPEN -> ACKNOWLEDGED; acknowledging again changes nothing; a RESOLVED alert is 409. */
    @Transactional
    @PreAuthorize(Permissions.HAS_ALERT_MANAGE)
    public AlertResponse acknowledge(UUID id) {
        Alert alert = alerts.findForUpdateById(id).orElseThrow(AlertService::missing);
        if (alert.getStatus() == AlertStatus.RESOLVED) throw new ConflictException("Alert is already resolved");
        if (alert.getStatus() == AlertStatus.OPEN) {
            alert.setStatus(AlertStatus.ACKNOWLEDGED);
            alert.setAcknowledgedAt(notBefore(now(), alert.getTriggeredAt()));
            alert.setAcknowledgedBy(users.getReferenceById(actor()));
            alerts.flush();
        }
        return response(alerts.findDetailsById(id).orElseThrow(AlertService::missing));
    }

    /** OPEN or ACKNOWLEDGED -> RESOLVED by the caller, with an optional note; a RESOLVED alert is 409 (also when the system won the race). */
    @Transactional
    @PreAuthorize(Permissions.HAS_ALERT_MANAGE)
    public AlertResponse resolve(UUID id, String note) {
        Alert alert = alerts.findForUpdateById(id).orElseThrow(AlertService::missing);
        if (alert.getStatus() == AlertStatus.RESOLVED) throw new ConflictException("Alert is already resolved");
        alert.setStatus(AlertStatus.RESOLVED);
        alert.setResolvedAt(notBefore(now(), alert.getTriggeredAt()));
        alert.setResolvedBy(users.getReferenceById(actor()));
        alert.setResolutionNote(note == null || note.isBlank() ? null : note.strip());
        alerts.flush();
        return response(alerts.findDetailsById(id).orElseThrow(AlertService::missing));
    }

    // ---- helpers ----

    AlertSpec hardwareSpec(UUID machineId, String machineCode, String code, AlertSeverity severity, boolean maintenance) {
        return new AlertSpec(AlertType.HARDWARE_FAULT, severity, machineId, null, code, AlertSpec.hardwareKey(machineId, code),
                AlertTemplates.title(AlertType.HARDWARE_FAULT, code), AlertTemplates.hardwareFault(machineCode, code, maintenance));
    }

    private static boolean known(String code) {
        return List.of(MachineErrorCode.Fault.values()).stream().anyMatch(fault -> fault.name().equals(code));
    }

    private static String errorCode(String reason) {
        return reason != null && ERROR_CODE.matcher(reason).matches() ? reason : null;
    }

    private String machineCode(UUID machineId) {
        return machines.findById(machineId).map(machine -> machine.getCode()).orElse(machineId.toString());
    }

    private static UUID actor() {
        return ((AuthenticatedUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal()).getId();
    }

    private AlertResponse response(Alert alert) {
        return responses(List.of(alert)).getFirst();
    }

    /** Issue #66: one query for the unfinished work orders handling the alerts of a page. */
    private List<AlertResponse> responses(List<Alert> page) {
        if (page.isEmpty()) return List.of();
        var active = workOrderLinks.findActiveLinks(page.stream().map(Alert::getId).toList()).stream()
                .collect(java.util.stream.Collectors.toMap(WorkOrderAlertRepository.ActiveLink::getAlertId, link -> link, (a, b) -> a));
        return page.stream().map(alert -> toResponse(alert, active.get(alert.getId()))).toList();
    }

    static AlertResponse toResponse(Alert alert, WorkOrderAlertRepository.ActiveLink workOrder) {
        var slot = alert.getSlot();
        var acknowledgedBy = alert.getAcknowledgedBy();
        var resolvedBy = alert.getResolvedBy();
        String resolver = alert.getStatus() != AlertStatus.RESOLVED ? null : resolvedBy == null ? "system" : resolvedBy.getEmail();
        return new AlertResponse(alert.getId(), alert.getMachine().getId(), alert.getMachine().getCode(), alert.getSlotId(),
                slot == null ? null : slot.getSlotCode(), alert.getType(), alert.getSeverity(), alert.getErrorCode(), alert.getTitle(),
                alert.getMessage(), alert.getStatus(), alert.getTriggeredAt(), alert.getAcknowledgedAt(),
                acknowledgedBy == null ? null : acknowledgedBy.getEmail(), alert.getResolvedAt(), resolver, alert.getResolutionNote(),
                workOrder == null ? null : workOrder.getWorkOrderId(), workOrder == null ? null : workOrder.getCode());
    }

    private static ResourceNotFoundException missing() {
        return new ResourceNotFoundException("Alert not found");
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }

    private static Instant notBefore(Instant candidate, Instant floor) {
        return floor != null && candidate.isBefore(floor) ? floor : candidate;
    }
}
