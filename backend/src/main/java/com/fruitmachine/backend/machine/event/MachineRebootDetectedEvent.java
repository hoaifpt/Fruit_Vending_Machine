package com.fruitmachine.backend.machine.event;

import java.util.UUID;

/** The reported uptime went down, so the controller restarted. Published inside the transaction; consume it after commit. */
public record MachineRebootDetectedEvent(UUID machineId, String machineCode, long previousUptimeSeconds, long newUptimeSeconds) {
}
