package com.fruitmachine.backend.machine.mapper;

import com.fruitmachine.backend.machine.dto.MachineResponse;
import com.fruitmachine.backend.machine.entity.Machine;
import org.springframework.stereotype.Component;

@Component
public class MachineMapper {
    public MachineResponse toResponse(Machine machine) {
        return new MachineResponse(machine.getId(), machine.getCode(), machine.getName(), machine.getLocation(),
                machine.getStatus(), machine.getTemperatureMin(), machine.getTemperatureMax(),
                machine.getHumidityMin(), machine.getHumidityMax(), machine.getLastSeenAt(),
                machine.getCreatedAt(), machine.getUpdatedAt());
    }
}
