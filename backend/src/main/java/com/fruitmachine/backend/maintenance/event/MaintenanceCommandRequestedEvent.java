package com.fruitmachine.backend.maintenance.event;

import java.util.UUID;

/** A new command committed: publish it right away instead of waiting for the next dispatcher tick. */
public record MaintenanceCommandRequestedEvent(UUID commandId) {
}
