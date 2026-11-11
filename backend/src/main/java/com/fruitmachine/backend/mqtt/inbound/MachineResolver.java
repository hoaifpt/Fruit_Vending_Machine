package com.fruitmachine.backend.mqtt.inbound;

import com.fruitmachine.backend.machine.repository.MachineRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** Machine code (topic level 2) to machine id. Any machine status is accepted; handlers decide what INACTIVE/MAINTENANCE means. */
@Component
@RequiredArgsConstructor
public class MachineResolver {
    private final MachineRepository machines;

    public UUID resolve(String machineCode, String messageId) {
        return machines.findIdByCode(machineCode).orElseThrow(() -> new MachineMessageRejectedException(
                RejectionReason.UNKNOWN_MACHINE, "No machine with this code", machineCode, messageId));
    }
}
