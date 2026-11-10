package com.fruitmachine.backend.mqtt.contract;

/**
 * Error code catalog of the contract (§6). Names are wire values: a published value never changes meaning and is never reused.
 * Every value is PROPOSED until the firmware owner signs off in issue #49; the backend acts on them in 3.3 / 3.6.
 */
public final class MachineErrorCode {
    /** {@code details.reason} on {@code *_REJECTED} / {@code *_ABORTED}. */
    public enum Reason {
        BUSY, CONTROLLER_FAULT, INVALID_COMMAND_ID, INVALID_COLUMN, UNSUPPORTED_SCHEMA, MANUAL_STOP, NO_BOWL_DETECTED,
        MULTIPLE_BOWLS_DETECTED, INTERRUPTED_BY_REBOOT
    }

    public enum Severity { WARNING, CRITICAL }

    /** {@code details.code} of a {@code FAULT} event. */
    public enum Fault {
        SERVO_INIT_FAILED(Severity.CRITICAL),
        GATE_POSITION_UNKNOWN(Severity.CRITICAL),
        CONTROLLER_FAULT(Severity.CRITICAL),
        IR_SENSOR_STUCK(Severity.WARNING),
        IR_SENSOR_DISCONNECTED(Severity.WARNING),
        UNEXPECTED_BOWL_DETECTED(Severity.WARNING),
        TEMP_SENSOR_ERROR(Severity.WARNING);

        private final Severity severity;

        Fault(Severity severity) {
            this.severity = severity;
        }

        public Severity severity() {
            return severity;
        }
    }

    /** {@code details.resetReason} of a {@code BOOT} event; WATCHDOG, PANIC and BROWNOUT raise a WARNING alert (3.6). */
    public enum ResetReason { POWERON, SOFTWARE, WATCHDOG, PANIC, BROWNOUT, UNKNOWN }

    private MachineErrorCode() {
    }
}
