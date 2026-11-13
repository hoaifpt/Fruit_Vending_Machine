package com.fruitmachine.backend.machine.service;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fruitmachine.backend.audit.entity.AuditLog;
import com.fruitmachine.backend.audit.repository.AuditLogRepository;
import com.fruitmachine.backend.common.exception.BadRequestException;
import com.fruitmachine.backend.common.exception.ConflictException;
import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.machine.dto.*;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.machine.enums.MachineConnectivity;
import com.fruitmachine.backend.machine.enums.MachineStatus;
import com.fruitmachine.backend.machine.event.MachineMaintenanceEnteredEvent;
import com.fruitmachine.backend.machine.mapper.MachineMapper;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import jakarta.persistence.criteria.Predicate;
import jakarta.validation.Valid;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import com.fruitmachine.backend.security.permission.Permissions;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;

@Service
@RequiredArgsConstructor
@Validated
public class MachineService {
    private static final Set<String> SORT_FIELDS = Set.of("id", "code", "name", "location", "status", "createdAt", "updatedAt");
    public static final String AUDIT_MAINTENANCE_AUTO = "MACHINE_MAINTENANCE_AUTO";
    private final MachineRepository machines;
    private final MachineMapper mapper;
    private final AuditLogRepository audits;
    private final ApplicationEventPublisher events;
    private final ConnectivityEvaluator connectivity;
    private final java.time.Clock clock;
    private final com.fruitmachine.backend.workorder.repository.WorkOrderRepository workOrders;

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_MACHINE_READ)
    public MachinePageResponse listMachines(int page, int size, MachineStatus status, MachineConnectivity connectivityFilter, String search, String sort) {
        if (page < 0 || size < 1 || size > 100) {
            throw new BadRequestException("Page must be nonnegative and size must be between 1 and 100");
        }
        String needle = search == null ? "" : search.strip().toLowerCase(Locale.ROOT);
        var now = clock.instant();
        if (needle.length() > 200) throw new BadRequestException("Search must not exceed 200 characters");
        var result = machines.findAll((root, query, cb) -> {
            var predicates = new ArrayList<Predicate>();
            if (status != null) predicates.add(cb.equal(root.get("status"), status));
            // Same rules as the connectivity field, as SQL on last_seen_at / last_offline_at: filtered and paged in the database.
            if (connectivityFilter != null) predicates.add(connectivity.predicate(connectivityFilter, root, cb, now));
            if (!needle.isEmpty()) {
                // LOCATE gives literal substring semantics: '%' and '_' are not wildcard input.
                predicates.add(cb.or(cb.greaterThan(cb.locate(cb.lower(root.get("name")), needle), 0),
                        cb.greaterThan(cb.locate(cb.lower(root.get("code")), needle), 0),
                        cb.greaterThan(cb.locate(cb.lower(root.get("location")), needle), 0)));
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        }, PageRequest.of(page, size, approvedSort(sort)));
        return new MachinePageResponse(result.getContent().stream().map(mapper::toResponse).toList(),
                page, size, result.getTotalElements(), result.getTotalPages());
    }

    private Sort approvedSort(String input) {
        String[] parts = (input == null ? "createdAt,desc" : input).split(",", -1);
        if (parts.length > 2 || !SORT_FIELDS.contains(parts[0])
                || (parts.length == 2 && !Set.of("asc", "desc").contains(parts[1].toLowerCase(Locale.ROOT)))) {
            throw new BadRequestException("Invalid machine sort; use an approved field and asc or desc");
        }
        Sort result = Sort.by(parts.length == 2 && parts[1].equalsIgnoreCase("desc") ? Sort.Direction.DESC : Sort.Direction.ASC, parts[0]);
        return parts[0].equals("id") ? result : result.and(Sort.by("id"));
    }

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_MACHINE_READ)
    public MachineResponse getMachine(UUID id) {
        return mapper.toResponse(machines.findById(id).orElseThrow(this::notFound));
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_MACHINE_WRITE)
    public MachineResponse createMachine(@Valid CreateMachineRequest request) {
        if (machines.existsByCode(request.code())) throw new ConflictException("Machine code is already in use");
        Machine machine = new Machine();
        machine.setCode(request.code());
        applyConfiguration(machine, request.name(), request.location(), request.minTemperature(), request.maxTemperature(), request.minHumidity(), request.maxHumidity());
        machine.setStatus(MachineStatus.INACTIVE);
        return mapper.toResponse(machines.saveAndFlush(machine));
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_MACHINE_WRITE)
    public MachineResponse updateMachine(UUID id, @Valid UpdateMachineRequest request) {
        Machine machine = machines.findForUpdateById(id).orElseThrow(this::notFound);
        applyConfiguration(machine, request.name(), request.location(), request.minTemperature(), request.maxTemperature(), request.minHumidity(), request.maxHumidity());
        machines.flush();
        return mapper.toResponse(machine);
    }

    @Transactional
    @PreAuthorize(Permissions.HAS_MACHINE_WRITE)
    public MachineResponse updateStatus(UUID id, @Valid UpdateMachineStatusRequest request) {
        Machine machine = machines.findForUpdateById(id).orElseThrow(this::notFound);
        // Issue #66: the machine is being worked on; the Admin reactivates it after the work order is DONE or CANCELLED.
        if (request.status() == MachineStatus.ACTIVE && machine.getStatus() != MachineStatus.ACTIVE
                && workOrders.existsByMachineIdAndStatus(id, com.fruitmachine.backend.workorder.enums.WorkOrderStatus.IN_PROGRESS))
            throw new ConflictException("WORK_ORDER_IN_PROGRESS: a work order of this machine is IN_PROGRESS; complete or cancel it first");
        machine.setStatus(request.status());
        machines.flush();
        return mapper.toResponse(machine);
    }

    /**
     * Protects customers after a hardware problem: an ACTIVE machine stops selling until an administrator has checked it and
     * sets it ACTIVE again (status endpoint, MACHINE_WRITE). Idempotent: MAINTENANCE and INACTIVE machines are left as they are.
     * Called by the system, not by a user, inside the caller's transaction; the caller should already hold the Machine row lock
     * when it holds Order or InventoryItem locks (lock order: Machine first).
     *
     * @return true when the status changed
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean enterMaintenanceBySystem(UUID machineId, String reason) {
        Machine machine = machines.findForUpdateById(machineId).orElseThrow(this::notFound);
        if (machine.getStatus() != MachineStatus.ACTIVE) return false;
        machine.setStatus(MachineStatus.MAINTENANCE);
        machines.flush();
        var row = new AuditLog();
        // user stays NULL: the system made this change.
        row.setAction(AUDIT_MAINTENANCE_AUTO);
        row.setEntityType("Machine");
        row.setEntityId(machineId);
        row.setOldValue(JsonNodeFactory.instance.objectNode().put("status", MachineStatus.ACTIVE.name()));
        row.setNewValue(JsonNodeFactory.instance.objectNode().put("status", MachineStatus.MAINTENANCE.name()).put("reason", reason));
        audits.save(row);
        events.publishEvent(new MachineMaintenanceEnteredEvent(machineId, machine.getCode(), reason));
        return true;
    }

    private void applyConfiguration(Machine machine, String name, String location,
            java.math.BigDecimal minTemperature, java.math.BigDecimal maxTemperature,
            java.math.BigDecimal minHumidity, java.math.BigDecimal maxHumidity) {
        if (minTemperature.compareTo(maxTemperature) >= 0 || minHumidity.compareTo(maxHumidity) >= 0) {
            throw new BadRequestException("Minimum environmental thresholds must be strictly below maximum thresholds");
        }
        machine.setName(name);
        machine.setLocation(location);
        machine.setTemperatureMin(minTemperature);
        machine.setTemperatureMax(maxTemperature);
        machine.setHumidityMin(minHumidity);
        machine.setHumidityMax(maxHumidity);
    }

    private ResourceNotFoundException notFound() {
        return new ResourceNotFoundException("Machine not found");
    }
}
