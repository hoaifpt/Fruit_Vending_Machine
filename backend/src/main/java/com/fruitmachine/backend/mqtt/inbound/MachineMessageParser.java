package com.fruitmachine.backend.mqtt.inbound;

import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import com.fruitmachine.backend.mqtt.config.MqttProperties;
import com.fruitmachine.backend.mqtt.message.MachineChannel;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * Topic and envelope validation (contract: api-contract/mqtt-contract.md). Only the envelope and "payload is a JSON object"
 * are checked here; field-level payload validation belongs to the channel handlers. Never logs or echoes payload content.
 */
@Component
public class MachineMessageParser {
    public static final int SUPPORTED_SCHEMA_VERSION = 1;
    public static final int MAX_MESSAGE_ID_LENGTH = 64;
    /** Machine codes usable on MQTT: uppercase, safe as a topic level, broker username and log value. */
    public static final Pattern MACHINE_CODE = Pattern.compile("[A-Z0-9][A-Z0-9._-]{0,63}");
    private static final Pattern MESSAGE_ID = Pattern.compile("[\\x21-\\x7E]{1," + MAX_MESSAGE_ID_LENGTH + "}");

    public record ParsedMessage(String machineCode, MachineChannel channel, String messageId, Instant sentAt, Instant receivedAt, JsonNode payload) {}

    private final ObjectReader reader;
    private final MqttProperties properties;
    private final Clock clock;

    public MachineMessageParser(ObjectMapper mapper, MqttProperties properties, Clock clock) {
        this.reader = mapper.reader()
                .with(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
        this.properties = properties;
        this.clock = clock;
    }

    public ParsedMessage parse(String topic, byte[] body) {
        Instant receivedAt = clock.instant();
        String[] levels = topic == null ? new String[0] : topic.split("/", -1);
        if (levels.length != 3 || !levels[0].equals(properties.topicRoot()) || !MACHINE_CODE.matcher(levels[1]).matches())
            throw reject(RejectionReason.INVALID_TOPIC, "Topic must be " + properties.topicRoot() + "/{MACHINE_CODE}/{channel}", null, null);
        String code = levels[1];
        MachineChannel channel = MachineChannel.fromTopicLevel(levels[2])
                .orElseThrow(() -> reject(RejectionReason.UNKNOWN_CHANNEL, "Channel must be telemetry, status or events", code, null));
        if (body == null || body.length > properties.maxPayloadBytes())
            throw reject(RejectionReason.PAYLOAD_TOO_LARGE, "Message exceeds " + properties.maxPayloadBytes() + " bytes", code, null);

        JsonNode root;
        try {
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(body)).toString();
            root = reader.readTree(text);
        } catch (CharacterCodingException e) {
            throw reject(RejectionReason.INVALID_JSON, "Message is not valid UTF-8", code, null);
        } catch (java.io.IOException e) {
            throw reject(RejectionReason.INVALID_JSON, "Message is not valid JSON", code, null);
        }
        if (root == null || !root.isObject()) throw reject(RejectionReason.INVALID_JSON, "Message must be a JSON object", code, null);

        JsonNode version = root.get("schemaVersion");
        if (version == null || !version.isIntegralNumber() || !version.canConvertToInt())
            throw reject(RejectionReason.INVALID_ENVELOPE, "schemaVersion must be an integer", code, null);
        if (version.intValue() != SUPPORTED_SCHEMA_VERSION)
            throw reject(RejectionReason.UNSUPPORTED_SCHEMA_VERSION, "Supported schemaVersion: " + SUPPORTED_SCHEMA_VERSION, code, null);

        JsonNode id = root.get("messageId");
        if (id == null || !id.isTextual() || !MESSAGE_ID.matcher(id.textValue()).matches())
            throw reject(RejectionReason.INVALID_ENVELOPE, "messageId must be 1-" + MAX_MESSAGE_ID_LENGTH + " visible ASCII characters", code, null);
        String messageId = id.textValue();

        JsonNode envelopeCode = root.get("machineCode");
        if (envelopeCode == null || !envelopeCode.isTextual())
            throw reject(RejectionReason.INVALID_ENVELOPE, "machineCode must be a string", code, messageId);
        if (!envelopeCode.textValue().equals(code))
            throw reject(RejectionReason.MACHINE_CODE_MISMATCH, "Envelope machineCode differs from the topic", code, messageId);

        // sentAt is optional (ESP32 may lack a reliable clock); when present it must be an ISO-8601 instant, otherwise the message is rejected.
        Instant sentAt = null;
        JsonNode sent = root.get("sentAt");
        if (sent != null && !sent.isNull()) {
            if (!sent.isTextual()) throw reject(RejectionReason.INVALID_ENVELOPE, "sentAt must be an ISO-8601 UTC string", code, messageId);
            try {
                sentAt = Instant.parse(sent.textValue());
            } catch (DateTimeParseException e) {
                throw reject(RejectionReason.INVALID_ENVELOPE, "sentAt must be an ISO-8601 UTC string", code, messageId);
            }
        }

        JsonNode payload = root.get("payload");
        if (payload == null || !payload.isObject()) throw reject(RejectionReason.INVALID_ENVELOPE, "payload must be a JSON object", code, messageId);
        return new ParsedMessage(code, channel, messageId, sentAt, receivedAt, payload);
    }

    private static MachineMessageRejectedException reject(RejectionReason reason, String detail, String code, String messageId) {
        return new MachineMessageRejectedException(reason, detail, code, messageId);
    }
}
