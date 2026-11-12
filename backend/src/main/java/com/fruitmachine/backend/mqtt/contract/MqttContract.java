package com.fruitmachine.backend.mqtt.contract;

import java.util.regex.Pattern;

/** Version and envelope of api-contract/mqtt-contract.md (issue #49). Tests keep these values equal to the contract. */
public final class MqttContract {
    public static final String CONTRACT_VERSION = "1.3.0";
    public static final int SCHEMA_VERSION = 1;

    public static final String SCHEMA_VERSION_FIELD = "schemaVersion";
    public static final String MESSAGE_ID_FIELD = "messageId";
    public static final String MACHINE_CODE_FIELD = "machineCode";
    public static final String PAYLOAD_FIELD = "payload";
    public static final int MESSAGE_ID_MAX_LENGTH = 64;

    /** Firmware limit for commandId: 1-39 characters. */
    public static final Pattern COMMAND_ID = Pattern.compile("[A-Za-z0-9_-]{1,39}");

    private MqttContract() {
    }
}
