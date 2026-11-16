package com.fruitmachine.backend.maintenance.enums;

import com.fruitmachine.backend.mqtt.contract.MachineCommandType;

/** What the machine is asked to do; {@link #commandType()} is the MQTT {@code payload.type} (contract §3.2, §3.3). */
public enum MaintenanceOperation {
    REMOVE_ITEM(MachineCommandType.MAINTENANCE_REMOVE_ITEM),
    EMPTY_COLUMN(MachineCommandType.MAINTENANCE_EMPTY_COLUMN),
    OPEN_REFILL(MachineCommandType.MAINTENANCE_OPEN_REFILL),
    CLOSE_REFILL(MachineCommandType.MAINTENANCE_CLOSE_REFILL),
    RESET(MachineCommandType.RESET);

    private final String commandType;

    MaintenanceOperation(String commandType) {
        this.commandType = commandType;
    }

    public String commandType() {
        return commandType;
    }

    /** REMOVE_ITEM and EMPTY_COLUMN take bowls out and need a reason. */
    public boolean removesBowls() {
        return this == REMOVE_ITEM || this == EMPTY_COLUMN;
    }
}
