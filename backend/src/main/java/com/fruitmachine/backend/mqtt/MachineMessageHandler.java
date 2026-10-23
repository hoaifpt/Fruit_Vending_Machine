package com.fruitmachine.backend.mqtt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.dispense.service.DispenseService;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * Parses machine messages ({@code <root>/<machineCode>/events|status}, envelope of docs/mqtt-dispense.md) and routes them.
 * Messages are untrusted input: malformed ones are logged and dropped, never retried.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MachineMessageHandler {
    private final ObjectMapper json;
    private final DispenseService dispense;
    private final MachineRepository machines;
    private final Clock clock;

    /** @param topicMachineCode the machine segment of the topic; the broker ACL ties it to the machine's account. */
    public void handle(String topicMachineCode, String channel, byte[] body) {
        JsonNode envelope;
        try {
            envelope = json.readTree(body);
        } catch (Exception ex) {
            log.warn("Unreadable MQTT {} message from {} dropped", channel, topicMachineCode);
            return;
        }
        String declared = envelope.path("machineCode").asText(topicMachineCode);
        if (!declared.equals(topicMachineCode)) {
            log.warn("MQTT message on {}'s topic declares machine {}; dropped", topicMachineCode, declared);
            return;
        }
        machines.touchLastSeen(topicMachineCode, clock.instant().truncatedTo(ChronoUnit.MICROS));
        if (!"events".equals(channel)) return;
        JsonNode payload = envelope.path("payload");
        String eventType = payload.path("eventType").asText("");
        String commandId = payload.path("details").path("commandId").asText(null);
        if (eventType.startsWith("DISPENSE_")) {
            var outcome = dispense.handleMachineEvent(topicMachineCode, eventType, commandId);
            log.info("Machine {} reported {} for {}: {}", topicMachineCode, eventType, commandId, outcome);
        }
    }
}
