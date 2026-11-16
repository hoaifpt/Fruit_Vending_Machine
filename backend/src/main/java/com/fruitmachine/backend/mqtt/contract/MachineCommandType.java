package com.fruitmachine.backend.mqtt.contract;

import java.util.List;

/** {@code payload.type} of a command (contract §3). */
public final class MachineCommandType {
    public static final String DISPENSE = "DISPENSE";
    public static final String MAINTENANCE_REMOVE_ITEM = "MAINTENANCE_REMOVE_ITEM";
    public static final String MAINTENANCE_EMPTY_COLUMN = "MAINTENANCE_EMPTY_COLUMN";
    public static final String MAINTENANCE_OPEN_REFILL = "MAINTENANCE_OPEN_REFILL";
    public static final String MAINTENANCE_CLOSE_REFILL = "MAINTENANCE_CLOSE_REFILL";
    public static final String RESET = "RESET";

    public static final String TYPE_FIELD = "type";
    public static final String COMMAND_ID_FIELD = "commandId";
    public static final String COLUMN_CODE_FIELD = "columnCode";

    public static final List<String> ALL = List.of(DISPENSE, MAINTENANCE_REMOVE_ITEM, MAINTENANCE_EMPTY_COLUMN, MAINTENANCE_OPEN_REFILL,
            MAINTENANCE_CLOSE_REFILL, RESET);

    private MachineCommandType() {
    }
}
