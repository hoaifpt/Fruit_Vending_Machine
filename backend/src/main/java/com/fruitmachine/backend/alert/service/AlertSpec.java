package com.fruitmachine.backend.alert.service;

import com.fruitmachine.backend.alert.enums.AlertSeverity;
import com.fruitmachine.backend.alert.enums.AlertType;
import java.util.UUID;

/** What to raise: one problem identified by {@code dedupeKey} (catalog in docs/alerts.md). */
public record AlertSpec(AlertType type, AlertSeverity severity, UUID machineId, UUID slotId, String errorCode, String dedupeKey,
        String title, String message) {

    public static String machineKey(AlertType type, UUID machineId) {
        return type.name() + ":" + machineId;
    }

    public static String slotKey(AlertType type, UUID slotId) {
        return type.name() + ":" + slotId;
    }

    public static String dispenseKey(UUID commandId) {
        return AlertType.DISPENSE_FAILED.name() + ":" + commandId;
    }

    public static String hardwareKey(UUID machineId, String errorCode) {
        return AlertType.HARDWARE_FAULT.name() + ":" + machineId + ":" + errorCode;
    }
}
