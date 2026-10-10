package com.fruitmachine.backend.machine.service;

import com.fruitmachine.backend.common.exception.*;
import com.fruitmachine.backend.machine.dto.slot.*;
import com.fruitmachine.backend.machine.entity.MachineSlot;
import com.fruitmachine.backend.machine.enums.SlotStatus;
import com.fruitmachine.backend.machine.mapper.MachineSlotMapper;
import com.fruitmachine.backend.machine.repository.*;
import jakarta.validation.Valid;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;

@Service
@RequiredArgsConstructor
@Validated
public class MachineSlotService {
    private static final Set<String> SORT_FIELDS = Set.of("id", "slotCode", "capacity", "status", "createdAt", "updatedAt");
    private final MachineRepository machines;
    private final MachineSlotRepository slots;
    private final MachineSlotMapper mapper;

    @Transactional(readOnly = true)
    @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    public MachineSlotPageResponse listSlots(UUID machineId, int page, int size, SlotStatus status, String sort) {
        if (page < 0 || size < 1 || size > 100)
            throw new BadRequestException("Page must be nonnegative and size must be between 1 and 100");
        requireMachine(machineId);
        var pageable = PageRequest.of(page, size, approvedSort(sort));
        var result = status == null ? slots.findByMachineId(machineId, pageable) : slots.findByMachineIdAndStatus(machineId, status, pageable);
        return new MachineSlotPageResponse(result.getContent().stream().map(mapper::toResponse).toList(),
                page, size, result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    public MachineSlotResponse getSlot(UUID machineId, UUID slotId) {
        requireMachine(machineId);
        return mapper.toResponse(slots.findByIdAndMachineId(slotId, machineId).orElseThrow(this::slotNotFound));
    }

    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public MachineSlotResponse createSlot(UUID machineId, @Valid CreateMachineSlotRequest request) {
        var machine = machines.findById(machineId).orElseThrow(this::machineNotFound);
        if (slots.existsByMachineIdAndSlotCode(machineId, request.slotCode()))
            throw new ConflictException("Slot code is already in use for this machine");
        var slot = new MachineSlot();
        slot.setMachine(machine);
        slot.setSlotCode(request.slotCode());
        slot.setCapacity(request.capacity());
        slot.setStatus(SlotStatus.ACTIVE);
        return mapper.toResponse(slots.saveAndFlush(slot));
    }

    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public MachineSlotResponse updateSlot(UUID machineId, UUID slotId, @Valid UpdateMachineSlotRequest request) {
        requireMachine(machineId);
        var slot = slots.findForUpdateByIdAndMachineId(slotId, machineId).orElseThrow(this::slotNotFound);
        slot.setCapacity(request.capacity());
        slots.flush();
        return mapper.toResponse(slot);
    }

    @Transactional
    @PreAuthorize("hasRole('ADMIN')")
    public MachineSlotResponse updateStatus(UUID machineId, UUID slotId, @Valid UpdateMachineSlotStatusRequest request) {
        requireMachine(machineId);
        var slot = slots.findForUpdateByIdAndMachineId(slotId, machineId).orElseThrow(this::slotNotFound);
        slot.setStatus(request.status());
        slots.flush();
        return mapper.toResponse(slot);
    }

    private Sort approvedSort(String input) {
        String[] parts = (input == null ? "slotCode,asc" : input).split(",", -1);
        if (parts.length > 2 || !SORT_FIELDS.contains(parts[0])
                || (parts.length == 2 && !Set.of("asc", "desc").contains(parts[1].toLowerCase(Locale.ROOT))))
            throw new BadRequestException("Invalid slot sort; use an approved field and asc or desc");
        Sort result = Sort.by(parts.length == 2 && parts[1].equalsIgnoreCase("desc") ? Sort.Direction.DESC : Sort.Direction.ASC, parts[0]);
        return parts[0].equals("id") ? result : result.and(Sort.by("id"));
    }
    private void requireMachine(UUID machineId) {
        if (!machines.existsById(machineId)) throw machineNotFound();
    }
    private ResourceNotFoundException machineNotFound() {
        return new ResourceNotFoundException("Machine not found");
    }
    private ResourceNotFoundException slotNotFound() {
        return new ResourceNotFoundException("Slot not found in specified machine");
    }
}
