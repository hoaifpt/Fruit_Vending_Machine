package com.fruitmachine.backend.maintenance.service;

/**
 * What a machine reported about a maintenance command (events channel). {@code reason} is the contract §6.1 reason (optional);
 * {@code state} is the controller state firmware v0.3.0 sends instead (e.g. HOLD_LOWER, FAULT).
 */
public record MaintenanceReport(String eventType, String commandCode, String reason, String state) {
}
