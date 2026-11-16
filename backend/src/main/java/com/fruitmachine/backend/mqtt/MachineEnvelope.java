package com.fruitmachine.backend.mqtt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.mqtt.contract.MqttContract;

/** A machine message that passed the envelope rules of api-contract/mqtt-contract.md §2. */
public record MachineEnvelope(String messageId, String machineCode, JsonNode payload) {
    /** Largest accepted message, envelope included; machines send a few hundred bytes. */
    public static final int MAX_BYTES = 8 * 1024;

    /** Why a message was dropped; the text goes to the WARN log, never back to the machine. */
    public static final class Invalid extends Exception {
        public Invalid(String reason) {
            super(reason, null, false, false);
        }
    }

    public static MachineEnvelope parse(JsonNode root, String topicMachineCode) throws Invalid {
        if (root == null || !root.isObject()) throw new Invalid("envelope is not a JSON object");
        JsonNode version = root.path(MqttContract.SCHEMA_VERSION_FIELD);
        if (!version.isIntegralNumber() || version.asLong() != MqttContract.SCHEMA_VERSION) throw new Invalid("unsupported or missing schemaVersion");
        JsonNode messageId = root.path(MqttContract.MESSAGE_ID_FIELD);
        if (!messageId.isTextual() || messageId.asText().isBlank() || messageId.asText().length() > MqttContract.MESSAGE_ID_MAX_LENGTH)
            throw new Invalid("missing, blank or too long messageId");
        JsonNode machineCode = root.path(MqttContract.MACHINE_CODE_FIELD);
        if (!machineCode.isTextual()) throw new Invalid("missing machineCode");
        if (!machineCode.asText().equals(topicMachineCode)) throw new Invalid("machineCode does not match the topic");
        JsonNode payload = root.path(MqttContract.PAYLOAD_FIELD);
        if (!payload.isObject()) throw new Invalid("payload is not a JSON object");
        return new MachineEnvelope(messageId.asText(), machineCode.asText(), payload);
    }
}
