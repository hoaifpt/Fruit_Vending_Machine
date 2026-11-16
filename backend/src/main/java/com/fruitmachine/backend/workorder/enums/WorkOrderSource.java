package com.fruitmachine.backend.workorder.enums;

/** Who caused the work order; the REST create endpoint always uses MANUAL. */
public enum WorkOrderSource {
    MANUAL, ALERT, SCHEDULE, CUSTOMER_REPORT
}
