package com.fruitmachine.backend.dispense;

import com.fruitmachine.backend.dispense.service.MachineCommandGateway;
import com.fruitmachine.backend.mqtt.MqttMachineGateway;
import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import static org.assertj.core.api.Assertions.assertThat;

/** With MQTT enabled and no broker, the application still starts and simply reports commands as not delivered. */
class MqttEnabledStartupTest extends AbstractCoreIntegrationTest {
    @DynamicPropertySource
    static void mqtt(DynamicPropertyRegistry registry) {
        registry.add("app.mqtt.enabled", () -> true);
        // Nothing listens on port 1 of the loopback address.
        registry.add("app.mqtt.broker-url", () -> "tcp://127.0.0.1:1");
    }

    @Autowired MachineCommandGateway gateway;

    @Test
    void theContextStartsWithTheMqttGatewayAndDeliveryFailsSoftWhileDisconnected() {
        assertThat(gateway).isInstanceOf(MqttMachineGateway.class);
        assertThat(gateway.sendDispense("TEST-MACHINE", "D-0000000000000000")).isFalse();
    }
}
