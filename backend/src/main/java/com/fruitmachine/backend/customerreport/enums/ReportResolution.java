package com.fruitmachine.backend.customerreport.enums;

import java.util.Set;

/** How a report was closed: resolve uses REFUNDED, FIXED, NO_ACTION_NEEDED; reject uses SPAM, DUPLICATE. */
public enum ReportResolution {
    REFUNDED, FIXED, NO_ACTION_NEEDED, SPAM, DUPLICATE;

    public static final Set<ReportResolution> RESOLVE = Set.of(REFUNDED, FIXED, NO_ACTION_NEEDED);
    public static final Set<ReportResolution> REJECT = Set.of(SPAM, DUPLICATE);
}
