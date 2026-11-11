package com.fruitmachine.backend.mqtt;

import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.integration.mqtt.core.MqttPahoClientFactory;
import org.springframework.integration.mqtt.inbound.MqttPahoMessageDrivenChannelAdapter;
import static org.assertj.core.api.Assertions.assertThat;

/** The default for tests and REST-only development: no MQTT client, no connection attempt, nothing listening on a broker. */
class MqttDisabledIntegrationTest extends AbstractCoreIntegrationTest {
    @Autowired ApplicationContext context;
    @Autowired MqttConnectionState state;

    @Test
    void mqttIsDisabledByDefaultAndNoClientIsCreated() {
        assertThat(context.getEnvironment().getProperty("app.mqtt.enabled")).isEqualTo("false");
        assertThat(context.getBeansOfType(MqttPahoMessageDrivenChannelAdapter.class)).isEmpty();
        assertThat(context.getBeansOfType(MqttPahoClientFactory.class)).isEmpty();
        assertThat(state.status()).isEqualTo(MqttConnectionState.Status.DISABLED);
        assertThat(Thread.getAllStackTraces().keySet()).noneMatch(t -> t.getName().startsWith("mqtt-inbound-start") || t.getName().startsWith("MQTT"));
    }
}
