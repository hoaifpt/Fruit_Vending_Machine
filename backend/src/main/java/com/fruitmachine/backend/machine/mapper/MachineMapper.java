package com.fruitmachine.backend.machine.mapper;

import com.fruitmachine.backend.machine.dto.MachineResponse;
import com.fruitmachine.backend.machine.entity.Machine;
import com.fruitmachine.backend.machine.service.ConnectivityEvaluator;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class MachineMapper {
    private final ConnectivityEvaluator connectivity;

    public MachineResponse toResponse(Machine machine) {
        return new MachineResponse(machine.getId(), machine.getCode(), machine.getName(), machine.getLocation(),
                machine.getStatus(), machine.getTemperatureMin(), machine.getTemperatureMax(),
                machine.getHumidityMin(), machine.getHumidityMax(), connectivity.evaluate(machine), machine.getLastSeenAt(),
                machine.getLastHeartbeatAt(), machine.getFirmwareVersion(), machine.getUptimeSeconds(),
                machine.getWifiRssi() == null ? null : machine.getWifiRssi().intValue(), machine.getFreeHeapBytes(),
                machine.getCreatedAt(), machine.getUpdatedAt());
    }
}
