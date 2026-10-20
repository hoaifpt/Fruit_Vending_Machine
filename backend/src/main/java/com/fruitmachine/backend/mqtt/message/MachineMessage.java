package com.fruitmachine.backend.mqtt.message;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/**
 * A validated machine message. The machine is trusted only because the broker ACL binds the topic to the machine account;
 * {@code sentAt} comes from the device clock and must not be used for ordering or freshness, {@code receivedAt} is the server clock.
 * Delivery is at-least-once (QoS 1): handlers must tolerate duplicates of {@code messageId}.
 */
public record MachineMessage(
        UUID machineId,
        String machineCode,
        MachineChannel channel,
        String messageId,
        Instant sentAt,
        Instant receivedAt,
        JsonNode payload) {
}
