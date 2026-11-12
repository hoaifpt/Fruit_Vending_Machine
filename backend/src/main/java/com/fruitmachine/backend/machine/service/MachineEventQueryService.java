package com.fruitmachine.backend.machine.service;

import com.fruitmachine.backend.common.exception.ResourceNotFoundException;
import com.fruitmachine.backend.common.request.TimeRange;
import com.fruitmachine.backend.machine.dto.event.MachineEventPageResponse;
import com.fruitmachine.backend.machine.dto.event.MachineEventResponse;
import com.fruitmachine.backend.machine.entity.MachineEvent;
import com.fruitmachine.backend.machine.enums.MachineEventSource;
import com.fruitmachine.backend.machine.repository.MachineEventRepository;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.security.permission.Permissions;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Machine history timeline for ADMIN/STAFF (MACHINE_READ), filtered and paged in the database. */
@Service
@RequiredArgsConstructor
public class MachineEventQueryService {
    public static final int MAX_PAGE_SIZE = 200;

    private final MachineRepository machines;
    private final MachineEventRepository events;

    @Transactional(readOnly = true)
    @PreAuthorize(Permissions.HAS_MACHINE_READ)
    public MachineEventPageResponse timeline(UUID machineId, String type, MachineEventSource source, Instant from, Instant to, int page, int size) {
        TimeRange.checkPage(page, size, MAX_PAGE_SIZE);
        TimeRange range = TimeRange.of(from, to);
        String exactType = type == null || type.isBlank() ? null : type.strip();
        if (!machines.existsById(machineId)) throw new ResourceNotFoundException("Machine not found");
        var result = events.findTimeline(machineId, exactType, source, range.from(), range.to(),
                PageRequest.of(page, size, Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))));
        return new MachineEventPageResponse(result.getContent().stream().map(MachineEventQueryService::toResponse).toList(),
                page, size, result.getTotalElements(), result.getTotalPages());
    }

    private static MachineEventResponse toResponse(MachineEvent event) {
        return new MachineEventResponse(event.getId(), event.getEventType(), event.getSource(), event.getMessageId(), event.getPayload(),
                event.getCreatedAt());
    }
}
