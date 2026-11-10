package com.fruitmachine.backend.mqtt.contract;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** {@code payload.eventType} on the events channel (contract §4): command lifecycle {@code <type>_<phase>} plus other events. */
public final class MachineEventType {
    public static final String ACCEPTED = "ACCEPTED";
    public static final String REJECTED = "REJECTED";
    public static final String COMPLETED = "COMPLETED";
    public static final String ABORTED = "ABORTED";
    public static final List<String> PHASES = List.of(ACCEPTED, REJECTED, COMPLETED, ABORTED);

    public static final String DISPENSE_PREFIX = MachineCommandType.DISPENSE + "_";
    public static final String DISPENSE_ACCEPTED = DISPENSE_PREFIX + ACCEPTED;
    public static final String DISPENSE_REJECTED = DISPENSE_PREFIX + REJECTED;
    public static final String DISPENSE_COMPLETED = DISPENSE_PREFIX + COMPLETED;
    public static final String DISPENSE_ABORTED = DISPENSE_PREFIX + ABORTED;

    public static final String BOWL_SENSOR_TRIGGERED = "BOWL_SENSOR_TRIGGERED";
    public static final String FAULT = "FAULT";
    public static final String FAULT_CLEARED = "FAULT_CLEARED";
    public static final String BOOT = "BOOT";

    public static final String EVENT_TYPE_FIELD = "eventType";
    public static final String DETAILS_FIELD = "details";
    public static final String REASON_FIELD = "reason";
    public static final String CODE_FIELD = "code";
    public static final String RESET_REASON_FIELD = "resetReason";

    /** Phases each command type answers with; RESET has no cycle, so it only accepts or rejects. */
    public static final Map<String, List<String>> LIFECYCLE = Map.of(
            MachineCommandType.DISPENSE, PHASES,
            MachineCommandType.MAINTENANCE_REMOVE_ITEM, PHASES,
            MachineCommandType.MAINTENANCE_EMPTY_COLUMN, PHASES,
            MachineCommandType.MAINTENANCE_OPEN_REFILL, PHASES,
            MachineCommandType.MAINTENANCE_CLOSE_REFILL, PHASES,
            MachineCommandType.RESET, List.of(ACCEPTED, REJECTED));

    public static final List<String> OTHER = List.of(BOWL_SENSOR_TRIGGERED, FAULT, FAULT_CLEARED, BOOT);

    /** Every event type of the contract. */
    public static final List<String> ALL;

    static {
        List<String> all = new ArrayList<>();
        for (String type : MachineCommandType.ALL) LIFECYCLE.get(type).forEach(phase -> all.add(type + "_" + phase));
        all.addAll(OTHER);
        ALL = List.copyOf(all);
    }

    private MachineEventType() {
    }
}
