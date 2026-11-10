package com.fruitmachine.backend.dispense.service;

import com.fruitmachine.backend.mqtt.contract.MachineErrorCode.Reason;
import java.util.Set;

/**
 * Values of {@code dispense_commands.failure_reason}: an extensible string validated here, not by a database list.
 * Machine reasons are the wire values of api-contract/mqtt-contract.md §6.1.
 */
public final class DispenseFailureReason {
    public static final String CONTROLLER_FAULT = Reason.CONTROLLER_FAULT.name();
    public static final String INVALID_COMMAND_ID = Reason.INVALID_COMMAND_ID.name();
    public static final String INVALID_COLUMN = Reason.INVALID_COLUMN.name();
    public static final String UNSUPPORTED_SCHEMA = Reason.UNSUPPORTED_SCHEMA.name();
    public static final String MANUAL_STOP = Reason.MANUAL_STOP.name();
    public static final String NO_BOWL_DETECTED = Reason.NO_BOWL_DETECTED.name();
    public static final String INTERRUPTED_BY_REBOOT = Reason.INTERRUPTED_BY_REBOOT.name();
    /** DISPENSE_ABORTED without a reason (firmware v0.3.0) or with one this backend does not know. */
    public static final String ABORTED_UNSPECIFIED = "ABORTED_UNSPECIFIED";

    /** Backend: published, but no result within {@code app.dispense.timeout} of the first delivery. */
    public static final String RESULT_TIMEOUT = "RESULT_TIMEOUT";
    /** Backend: never published within {@code app.dispense.pending-timeout}. */
    public static final String NOT_DELIVERED = "NOT_DELIVERED";
    /** Rows that failed before the column existed (V14 backfill); never written by the application. */
    public static final String LEGACY_UNKNOWN = "LEGACY_UNKNOWN";

    /** DISPENSE_REJECTED reasons that mean the command was not started: the machine did not move. */
    public static final Set<String> NOT_EXECUTED = Set.of(CONTROLLER_FAULT, INVALID_COMMAND_ID, INVALID_COLUMN, UNSUPPORTED_SCHEMA);
    /** Reasons a DISPENSE_ABORTED may carry; anything else is stored as {@link #ABORTED_UNSPECIFIED}. */
    public static final Set<String> ABORTED = Set.of(MANUAL_STOP, NO_BOWL_DETECTED, INTERRUPTED_BY_REBOOT, CONTROLLER_FAULT);
    /** Everything the application may write. */
    public static final Set<String> WRITABLE = Set.of(CONTROLLER_FAULT, INVALID_COMMAND_ID, INVALID_COLUMN, UNSUPPORTED_SCHEMA, MANUAL_STOP,
            NO_BOWL_DETECTED, INTERRUPTED_BY_REBOOT, ABORTED_UNSPECIFIED, RESULT_TIMEOUT, NOT_DELIVERED);

    private DispenseFailureReason() {
    }

    public static String ofAborted(String reported) {
        return reported != null && ABORTED.contains(reported) ? reported : ABORTED_UNSPECIFIED;
    }
}
