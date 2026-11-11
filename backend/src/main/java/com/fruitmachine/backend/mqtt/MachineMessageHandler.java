package com.fruitmachine.backend.mqtt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.dispense.service.DispenseReport;
import com.fruitmachine.backend.dispense.service.DispenseService;
import com.fruitmachine.backend.machine.repository.MachineRepository;
import com.fruitmachine.backend.machine.service.MachinePresenceService;
import com.fruitmachine.backend.machine.service.MachinePresenceService.Heartbeat;
import com.fruitmachine.backend.mqtt.contract.MachineChannel;
import com.fruitmachine.backend.mqtt.contract.MachineCommandType;
import com.fruitmachine.backend.mqtt.contract.MachineEventType;
import com.fruitmachine.backend.sensor.service.TelemetryService;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * Validates and routes machine messages ({@code <root>/<machineCode>/<channel>}, api-contract/mqtt-contract.md). Messages are
 * untrusted input: anything that breaks the envelope or payload rules, or comes from an unknown machine, is logged at WARN and
 * dropped, never retried, and changes nothing. The receive time is the backend clock; device timestamps are not used.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MachineMessageHandler {
    static final String STATE_FIELD = "state";
    static final String ONLINE = "ONLINE";
    static final String OFFLINE = "OFFLINE";
    static final int FIRMWARE_VERSION_MAX = 32;

    private final ObjectMapper json;
    private final DispenseService dispense;
    private final MachineRepository machines;
    private final MachinePresenceService presence;
    private final TelemetryService telemetry;
    private final Clock clock;

    /** @param topicMachineCode the machine segment of the topic; the broker ACL ties it to the machine's account. */
    public void handle(String topicMachineCode, String channel, byte[] body) {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        MachineEnvelope envelope;
        try {
            if (body == null || body.length > MachineEnvelope.MAX_BYTES) throw new MachineEnvelope.Invalid("message larger than 8 KB");
            JsonNode root;
            try {
                root = json.readTree(body);
            } catch (Exception ex) {
                throw new MachineEnvelope.Invalid("not valid UTF-8 JSON");
            }
            envelope = MachineEnvelope.parse(root, topicMachineCode);
        } catch (MachineEnvelope.Invalid invalid) {
            drop(topicMachineCode, channel, null, invalid.getMessage());
            return;
        }
        UUID machineId = machines.findIdByCode(topicMachineCode).orElse(null);
        if (machineId == null) {
            drop(topicMachineCode, channel, envelope.messageId(), "unknown machine code");
            return;
        }
        try {
            switch (channel) {
                case MachineChannel.EVENTS -> event(machineId, envelope, now);
                case MachineChannel.STATUS -> status(machineId, envelope, now);
                case MachineChannel.HEARTBEAT -> presence.heartbeat(machineId, topicMachineCode, heartbeat(envelope.payload()), now);
                case MachineChannel.TELEMETRY -> telemetry.record(machineId, topicMachineCode, envelope.messageId(), envelope.payload(), now);
                default -> throw new MachineEnvelope.Invalid("unknown channel");
            }
        } catch (MachineEnvelope.Invalid invalid) {
            drop(topicMachineCode, channel, envelope.messageId(), invalid.getMessage());
        }
    }

    private void event(UUID machineId, MachineEnvelope envelope, Instant now) {
        presence.touch(machineId, envelope.machineCode(), now);
        JsonNode payload = envelope.payload();
        String eventType = payload.path(MachineEventType.EVENT_TYPE_FIELD).asText("");
        JsonNode details = payload.path(MachineEventType.DETAILS_FIELD);
        String commandId = details.path(MachineCommandType.COMMAND_ID_FIELD).asText(null);
        if (eventType.startsWith(MachineEventType.DISPENSE_PREFIX)) {
            // Optional details (contract §4.1): a value of the wrong type is treated as absent.
            JsonNode reason = details.path(MachineEventType.REASON_FIELD), bowlCount = details.path(MachineEventType.BOWL_COUNT_FIELD);
            var report = new DispenseReport(eventType, commandId, reason.isTextual() ? reason.asText() : null,
                    bowlCount.isIntegralNumber() && bowlCount.canConvertToInt() ? bowlCount.asInt() : null);
            var outcome = dispense.handleMachineEvent(envelope.machineCode(), report);
            log.info("Machine {} reported {} for {}: {}", envelope.machineCode(), eventType, commandId, outcome);
        }
    }

    /** Contract §5.1: ONLINE on every connect (with optional diagnostics), OFFLINE as the Last Will. */
    private void status(UUID machineId, MachineEnvelope envelope, Instant now) throws MachineEnvelope.Invalid {
        JsonNode payload = envelope.payload();
        String state = payload.path(STATE_FIELD).isTextual() ? payload.path(STATE_FIELD).asText() : "";
        switch (state) {
            case ONLINE -> presence.online(machineId, envelope.machineCode(), optionalFirmware(payload), optionalUptime(payload), now);
            case OFFLINE -> presence.offline(machineId, envelope.machineCode(), now);
            default -> throw new MachineEnvelope.Invalid("status state must be ONLINE or OFFLINE");
        }
    }

    /** Contract §5.2: state ONLINE, uptimeSeconds and firmwareVersion required; wifiRssi and freeHeap optional. */
    static Heartbeat heartbeat(JsonNode payload) throws MachineEnvelope.Invalid {
        if (!ONLINE.equals(payload.path(STATE_FIELD).asText(null)) || !payload.path(STATE_FIELD).isTextual())
            throw new MachineEnvelope.Invalid("heartbeat state must be ONLINE");
        Long uptime = optionalUptime(payload);
        String firmware = optionalFirmware(payload);
        if (uptime == null || firmware == null) throw new MachineEnvelope.Invalid("heartbeat needs uptimeSeconds and firmwareVersion");
        Short rssi = null;
        JsonNode rssiNode = payload.path("wifiRssi");
        if (present(rssiNode)) {
            if (!rssiNode.isIntegralNumber() || !rssiNode.canConvertToInt() || rssiNode.asInt() < -127 || rssiNode.asInt() > 0)
                throw new MachineEnvelope.Invalid("wifiRssi must be an integer from -127 to 0");
            rssi = (short) rssiNode.asInt();
        }
        Long heap = null;
        JsonNode heapNode = payload.path("freeHeap");
        if (present(heapNode)) {
            if (!heapNode.isIntegralNumber() || !heapNode.canConvertToLong() || heapNode.asLong() < 0)
                throw new MachineEnvelope.Invalid("freeHeap must be a non-negative integer");
            heap = heapNode.asLong();
        }
        return new Heartbeat(uptime, firmware, rssi, heap);
    }

    private static Long optionalUptime(JsonNode payload) throws MachineEnvelope.Invalid {
        JsonNode node = payload.path("uptimeSeconds");
        if (!present(node)) return null;
        if (!node.isIntegralNumber() || !node.canConvertToLong() || node.asLong() < 0)
            throw new MachineEnvelope.Invalid("uptimeSeconds must be a non-negative integer");
        return node.asLong();
    }

    private static String optionalFirmware(JsonNode payload) throws MachineEnvelope.Invalid {
        JsonNode node = payload.path("firmwareVersion");
        if (!present(node)) return null;
        if (!node.isTextual() || node.asText().isBlank() || node.asText().length() > FIRMWARE_VERSION_MAX)
            throw new MachineEnvelope.Invalid("firmwareVersion must be text of 1 to 32 characters");
        return node.asText();
    }

    private static boolean present(JsonNode node) {
        return !node.isMissingNode() && !node.isNull();
    }

    private static void drop(String machineCode, String channel, String messageId, String reason) {
        log.warn("MQTT {} message from {} (messageId {}) dropped: {}", channel, machineCode, messageId == null ? "-" : messageId, reason);
    }
}
