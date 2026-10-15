package com.fruitmachine.backend.machine.kiosk.dto;

import com.fruitmachine.backend.machine.enums.MachineStatus;
import java.util.UUID;

public record KioskIdentityResponse(UUID machineId, String machineCode, String machineName, MachineStatus machineStatus) {
}
