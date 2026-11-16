package com.fruitmachine.backend.workorder.enums;

/** What the job is; RESTOCK and MAINTENANCE always stop the machine when started. */
public enum WorkOrderType {
    RESTOCK, MAINTENANCE, INCIDENT
}
