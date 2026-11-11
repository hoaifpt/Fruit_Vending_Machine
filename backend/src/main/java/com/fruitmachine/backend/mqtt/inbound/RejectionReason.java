package com.fruitmachine.backend.mqtt.inbound;

/** Why an inbound MQTT message was dropped; also the {@code reason} tag of the rejected-messages counter. */
public enum RejectionReason {
    INVALID_TOPIC,
    UNKNOWN_CHANNEL,
    PAYLOAD_TOO_LARGE,
    INVALID_JSON,
    INVALID_ENVELOPE,
    UNSUPPORTED_SCHEMA_VERSION,
    MACHINE_CODE_MISMATCH,
    UNKNOWN_MACHINE
}
