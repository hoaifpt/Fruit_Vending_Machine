package com.fruitmachine.backend.machine.event;

import java.time.Instant;
import java.util.UUID;

/** A status OFFLINE message arrived (normally the Last Will published by the broker). Consume it after commit. */
public record MachineOfflineReportedEvent(UUID machineId, String machineCode, Instant reportedAt) {
}
