package com.fruitmachine.backend.workorder.enums;

/** One history row of a work order. */
public enum WorkOrderEventType {
    CREATED, ASSIGNED, UNASSIGNED, STARTED, COMPLETED, CANCELLED, UPDATED, NOTE, OVERDUE
}
