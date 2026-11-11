package com.fruitmachine.backend.machine.event;

import java.util.UUID;

/** The system moved an ACTIVE machine to MAINTENANCE; published inside that transaction, consume it after commit. */
public record MachineMaintenanceEnteredEvent(UUID machineId, String machineCode, String reason) {
}
