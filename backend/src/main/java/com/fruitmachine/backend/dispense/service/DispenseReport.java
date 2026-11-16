package com.fruitmachine.backend.dispense.service;

import com.fruitmachine.backend.mqtt.contract.MachineErrorCode;

/**
 * What a machine reported about one command (events channel, contract §4.1). {@code reason} and {@code bowlCount} are optional:
 * firmware v0.3.0 sends neither.
 */
public record DispenseReport(String eventType, String commandCode, String reason, Integer bowlCount) {
    public static DispenseReport of(String eventType, String commandCode) {
        return new DispenseReport(eventType, commandCode, null, null);
    }

    public boolean severalBowls() {
        return (bowlCount != null && bowlCount > 1) || MachineErrorCode.Reason.MULTIPLE_BOWLS_DETECTED.name().equals(reason);
    }
}
