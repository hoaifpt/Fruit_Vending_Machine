package com.fruitmachine.backend.mqtt.message;

import java.util.Optional;

/** Machine-to-backend MQTT channels; the last topic level. There is no command, dispense, payment or order channel. */
public enum MachineChannel {
    TELEMETRY("telemetry"),
    STATUS("status"),
    EVENT("events");

    private final String topicLevel;

    MachineChannel(String topicLevel) {
        this.topicLevel = topicLevel;
    }

    public String topicLevel() {
        return topicLevel;
    }

    public static Optional<MachineChannel> fromTopicLevel(String level) {
        for (MachineChannel channel : values()) if (channel.topicLevel.equals(level)) return Optional.of(channel);
        return Optional.empty();
    }
}
