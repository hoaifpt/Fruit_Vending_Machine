package com.fruitmachine.backend.mqtt;

import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import java.net.ServerSocket;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.integration.mqtt.inbound.MqttPahoMessageDrivenChannelAdapter;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/** MQTT enabled but no broker listening: the application starts, REST and health work, the client keeps retrying quietly. */
@ExtendWith(OutputCaptureExtension.class)
class MqttUnavailableBrokerIntegrationTest extends AbstractCoreIntegrationTest {
    static final String PASSWORD = "unreachable-" + java.util.UUID.randomUUID();
    static final int CLOSED_PORT = freePort();

    static int freePort() {
        try (var socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void mqttProperties(DynamicPropertyRegistry registry) {
        registry.add("app.mqtt.enabled", () -> "true");
        registry.add("app.mqtt.broker-url", () -> "tcp://127.0.0.1:" + CLOSED_PORT);
        registry.add("app.mqtt.username", () -> "fvm-backend");
        registry.add("app.mqtt.password", () -> PASSWORD);
        registry.add("app.mqtt.completion-timeout", () -> "PT1S");
        registry.add("app.mqtt.max-reconnect-delay", () -> "PT1S");
    }

    @Autowired MqttConnectionState state;
    @Autowired MqttPahoMessageDrivenChannelAdapter adapter;

    @Test
    void applicationStartsAndRestWorksWithoutABroker(CapturedOutput output) throws Exception {
        var health = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/actuator/health")).andReturn().getResponse();
        assertThat(health.getStatus()).isEqualTo(200);
        assertThat(health.getContentAsString()).contains("UP");
        assertThat(fixtures.api("GET", "/api/v1/machines?size=1", null, admin.token(), 200).path("content").isArray()).isTrue();
        await().atMost(Duration.ofSeconds(15)).untilAsserted(() -> assertThat(output).contains("not reachable or refused the connection"));
        assertThat(state.status()).isNotEqualTo(MqttConnectionState.Status.CONNECTED);
        // Still retrying in the background, and the REST API is unaffected meanwhile.
        Thread.sleep(2500);
        assertThat(fixtures.api("GET", "/api/v1/machines?size=1", null, staff.token(), 200).path("content").isArray()).isTrue();
        assertThat(output).doesNotContain(PASSWORD);
    }
}
