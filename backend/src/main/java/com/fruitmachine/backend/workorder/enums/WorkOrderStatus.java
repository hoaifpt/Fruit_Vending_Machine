package com.fruitmachine.backend.workorder.enums;

import java.util.EnumSet;
import java.util.Set;

/** OPEN -> ASSIGNED -> IN_PROGRESS -> DONE; CANCELLED from any unfinished state. DONE and CANCELLED are final. */
public enum WorkOrderStatus {
    OPEN, ASSIGNED, IN_PROGRESS, DONE, CANCELLED;

    public static final Set<WorkOrderStatus> UNFINISHED = EnumSet.of(OPEN, ASSIGNED, IN_PROGRESS);

    public boolean finished() {
        return this == DONE || this == CANCELLED;
    }
}
