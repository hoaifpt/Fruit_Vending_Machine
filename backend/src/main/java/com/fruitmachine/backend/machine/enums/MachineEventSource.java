package com.fruitmachine.backend.machine.enums;

/** Who produced a machine_events row: the machine (an MQTT message, with its messageId) or the backend (a decision about it). */
public enum MachineEventSource {
    MACHINE, BACKEND
}
