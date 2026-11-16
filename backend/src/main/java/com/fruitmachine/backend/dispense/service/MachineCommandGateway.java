package com.fruitmachine.backend.dispense.service;

/** Transport that hands a dispense command to a machine. Delivery is at-least-once; the firmware ignores repeated codes. */
public interface MachineCommandGateway {
    /**
     * @param columnCode the physical column to release from: the slot code of the command ("A" or "B")
     * @return true when the transport accepted the command for delivery, false when it is not connected.
     */
    boolean sendDispense(String machineCode, String commandCode, String columnCode);

    /**
     * Issue #64: a maintenance command for one column.
     *
     * @param commandType MAINTENANCE_REMOVE_ITEM, MAINTENANCE_EMPTY_COLUMN, MAINTENANCE_OPEN_REFILL or MAINTENANCE_CLOSE_REFILL
     * @return true when the transport accepted it for delivery; transports without maintenance support return false
     */
    default boolean sendMaintenance(String machineCode, String commandType, String commandCode, String columnCode) {
        return false;
    }

    /** Issue #64: RESET of a controller fault (no column). */
    default boolean sendReset(String machineCode, String commandCode) {
        return false;
    }
}
