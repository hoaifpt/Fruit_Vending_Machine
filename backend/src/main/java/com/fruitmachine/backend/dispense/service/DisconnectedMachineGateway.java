package com.fruitmachine.backend.dispense.service;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Used while MQTT is disabled: nothing is delivered, so commands stay PENDING until they time out. */
@Component
@ConditionalOnProperty(name = "app.mqtt.enabled", havingValue = "false", matchIfMissing = true)
public class DisconnectedMachineGateway implements MachineCommandGateway {
    @Override
    public boolean sendDispense(String machineCode, String commandCode) {
        return false;
    }
}
