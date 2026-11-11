package com.fruitmachine.backend.mqtt.contract;

import java.util.Map;
import java.util.UUID;

/** Builds command envelopes as published by the backend (contract §2-§3). */
public final class MachineCommands {
    private MachineCommands() {
    }

    /** @param columnCode slot code of the column that holds the bowl, "A" or "B" */
    public static Map<String, Object> dispense(String machineCode, String commandId, String columnCode) {
        return Map.of(
                MqttContract.SCHEMA_VERSION_FIELD, MqttContract.SCHEMA_VERSION,
                MqttContract.MESSAGE_ID_FIELD, UUID.randomUUID().toString(),
                MqttContract.MACHINE_CODE_FIELD, machineCode,
                MqttContract.PAYLOAD_FIELD, Map.of(
                        MachineCommandType.TYPE_FIELD, MachineCommandType.DISPENSE,
                        MachineCommandType.COMMAND_ID_FIELD, commandId,
                        MachineCommandType.COLUMN_CODE_FIELD, columnCode));
    }
}
