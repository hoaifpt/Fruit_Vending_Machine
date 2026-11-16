package com.fruitmachine.backend.workorder.enums;

import com.fruitmachine.backend.alert.enums.AlertSeverity;

public enum WorkOrderPriority {
    LOW, NORMAL, HIGH, URGENT;

    /** Default for a work order created from an alert: CRITICAL -> URGENT, WARNING -> HIGH, INFO -> NORMAL. */
    public static WorkOrderPriority of(AlertSeverity severity) {
        return switch (severity) {
            case CRITICAL -> URGENT;
            case WARNING -> HIGH;
            case INFO -> NORMAL;
        };
    }

    /** Notification severity for this priority. */
    public AlertSeverity severity() {
        return switch (this) {
            case URGENT -> AlertSeverity.CRITICAL;
            case HIGH -> AlertSeverity.WARNING;
            default -> AlertSeverity.INFO;
        };
    }
}
