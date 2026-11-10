package com.fruitmachine.backend.machine.enums;

/**
 * Derived from presence (never stored): whether the machine is talking to the backend. Separate from the administrative
 * {@link MachineStatus}; connectivity alone does not block sales.
 */
public enum MachineConnectivity {
    ONLINE, WARNING, OFFLINE, NEVER_SEEN
}
