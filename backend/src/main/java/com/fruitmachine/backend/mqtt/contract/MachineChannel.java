package com.fruitmachine.backend.mqtt.contract;

import java.util.List;

/** Last topic level of {@code <root>/<machineCode>/<channel>} (contract §1). */
public final class MachineChannel {
    /** Backend to machine. */
    public static final String COMMANDS = "commands";
    public static final String EVENTS = "events";
    public static final String STATUS = "status";
    public static final String HEARTBEAT = "heartbeat";
    /** The backend handles it (#53); the firmware sends it once a sensor exists. */
    public static final String TELEMETRY = "telemetry";

    public static final List<String> ALL = List.of(COMMANDS, EVENTS, STATUS, HEARTBEAT, TELEMETRY);
    /** Machine-to-backend channels the backend subscribes to (every machine-to-backend channel since #53). */
    public static final List<String> SUBSCRIBED = List.of(EVENTS, STATUS, HEARTBEAT, TELEMETRY);

    private MachineChannel() {
    }
}
