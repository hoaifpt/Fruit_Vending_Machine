package com.fruitmachine.backend.mqtt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.dispense.service.DispenseReport;
import com.fruitmachine.backend.dispense.service.DispenseService;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.mqtt.contract.MachineChannel;
import com.fruitmachine.backend.mqtt.contract.MachineCommandType;
import com.fruitmachine.backend.mqtt.contract.MachineEventType;
import com.fruitmachine.backend.mqtt.contract.MqttContract;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * Parses machine messages ({@code <root>/<machineCode>/events|status}, envelope of api-contract/mqtt-contract.md) and routes them.
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
        String declared = envelope.path(MqttContract.MACHINE_CODE_FIELD).asText(topicMachineCode);
        if (!declared.equals(topicMachineCode)) {
            log.warn("MQTT message on {}'s topic declares machine {}; dropped", topicMachineCode, declared);
            return;
        }
        machines.touchLastSeen(topicMachineCode, clock.instant().truncatedTo(ChronoUnit.MICROS));
        if (!MachineChannel.EVENTS.equals(channel)) return;
        JsonNode payload = envelope.path(MqttContract.PAYLOAD_FIELD);
        String eventType = payload.path(MachineEventType.EVENT_TYPE_FIELD).asText("");
        JsonNode details = payload.path(MachineEventType.DETAILS_FIELD);
        String commandId = details.path(MachineCommandType.COMMAND_ID_FIELD).asText(null);
        if (eventType.startsWith(MachineEventType.DISPENSE_PREFIX)) {
            // Optional details (contract §4.1): a value of the wrong type is treated as absent.
            JsonNode reason = details.path(MachineEventType.REASON_FIELD), bowlCount = details.path(MachineEventType.BOWL_COUNT_FIELD);
            var report = new DispenseReport(eventType, commandId, reason.isTextual() ? reason.asText() : null,
                    bowlCount.isIntegralNumber() && bowlCount.canConvertToInt() ? bowlCount.asInt() : null);
            var outcome = dispense.handleMachineEvent(topicMachineCode, report);
            log.info("Machine {} reported {} for {}: {}", topicMachineCode, eventType, commandId, outcome);
        }
    }
}
