package com.fruitmachine.backend.maintenance.enums;

import java.util.EnumSet;
import java.util.Set;

/**
 * PENDING -> SENT -> ACCEPTED -> COMPLETED; REJECTED (not busy) or no ACCEPTED in time -> FAILED; ABORTED or no COMPLETED in time
 * -> NEEDS_RECONCILIATION -> RECONCILED (Staff). PENDING, SENT and ACCEPTED are unfinished: at most one per machine.
 */
public enum MaintenanceCommandStatus {
    PENDING, SENT, ACCEPTED, COMPLETED, FAILED, NEEDS_RECONCILIATION, RECONCILED;

    public static final Set<MaintenanceCommandStatus> UNFINISHED = EnumSet.of(PENDING, SENT, ACCEPTED);

    public boolean unfinished() {
        return UNFINISHED.contains(this);
    }
}
