package com.fruitmachine.backend.dispense.service;

/** Transport that hands a dispense command to a machine. Delivery is at-least-once; the firmware ignores repeated codes. */
public interface MachineCommandGateway {
    /** @return true when the transport accepted the command for delivery, false when it is not connected. */
    boolean sendDispense(String machineCode, String commandCode);
}
