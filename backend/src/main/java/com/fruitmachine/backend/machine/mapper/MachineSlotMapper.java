package com.fruitmachine.backend.machine.mapper;

import com.fruitmachine.backend.machine.dto.slot.MachineSlotResponse;
import com.fruitmachine.backend.machine.entity.MachineSlot;
import org.springframework.stereotype.Component;

@Component
public class MachineSlotMapper {
    public MachineSlotResponse toResponse(MachineSlot slot) {
        // The read-only machineId mirror is not hydrated on a newly persisted entity.
        // A parent proxy's identifier is available without initializing its collections.
        return new MachineSlotResponse(slot.getId(), slot.getMachine().getId(), slot.getSlotCode(),
                slot.getCapacity(), slot.getStatus(), slot.getCreatedAt(), slot.getUpdatedAt());
    }
}
