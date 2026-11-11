package com.fruitmachine.backend.mqtt.contract;

import java.util.Optional;

/** A parsed {@code <root>/<machineCode>/<channel>} topic; any other number of levels is not a contract topic (contract §1). */
public record MachineTopic(String root, String machineCode, String channel) {
    public static final int LEVELS = 3;

    public static Optional<MachineTopic> parse(String topic) {
        String[] parts = topic.split("/", -1);
        if (parts.length != LEVELS) return Optional.empty();
        return Optional.of(new MachineTopic(parts[0], parts[1], parts[2]));
    }

    public static String of(String root, String machineCode, String channel) {
        return root + "/" + machineCode + "/" + channel;
    }

    /** Subscription filter for one channel of every machine. */
    public static String allMachines(String root, String channel) {
        return of(root, "+", channel);
    }
}
