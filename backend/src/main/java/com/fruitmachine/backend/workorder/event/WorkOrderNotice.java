package com.fruitmachine.backend.workorder.event;

import java.util.UUID;

/** Published inside a work order transaction; WorkOrderNotifier turns it into portal notifications after the commit. */
public record WorkOrderNotice(UUID workOrderId, Kind kind, UUID actorId) {
    public enum Kind { ASSIGNED, SYSTEM_CREATED, COMPLETED, CANCELLED, OVERDUE }
}
