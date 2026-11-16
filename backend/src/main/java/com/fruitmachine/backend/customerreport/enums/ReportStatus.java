package com.fruitmachine.backend.customerreport.enums;

import java.util.Set;

/** NEW -> IN_REVIEW -> RESOLVED / REJECTED; RESOLVED and REJECTED are final. */
public enum ReportStatus {
    NEW, IN_REVIEW, RESOLVED, REJECTED;

    public static final Set<ReportStatus> OPEN = Set.of(NEW, IN_REVIEW);

    public boolean open() {
        return OPEN.contains(this);
    }
}
