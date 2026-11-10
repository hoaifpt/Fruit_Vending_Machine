package com.fruitmachine.backend.dispense.service;

/** Transport that hands a dispense command to a machine. Delivery is at-least-once; the firmware ignores repeated codes. */
public interface MachineCommandGateway {
    /**
     * @param columnCode the physical column to release from: the slot code of the command ("A" or "B")
     * @return true when the transport accepted the command for delivery, false when it is not connected.
     */
    boolean sendDispense(String machineCode, String commandCode, String columnCode);
}
