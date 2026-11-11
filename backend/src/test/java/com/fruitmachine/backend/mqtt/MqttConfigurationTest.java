package com.fruitmachine.backend.mqtt;

import com.fruitmachine.backend.mqtt.config.MqttInboundConfig;
import com.fruitmachine.backend.mqtt.config.MqttProperties;
import com.fruitmachine.backend.mqtt.config.MqttPropertiesConfig;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.integration.mqtt.inbound.MqttPahoMessageDrivenChannelAdapter;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MqttConfigurationTest {
    static final String SECRET = "Sup3r-Secret-Mqtt-Passw0rd";

    private MqttProperties bind(Map<String, String> overrides) {
        var values = new HashMap<String, String>(overrides);
        return new Binder(new MapConfigurationPropertySource(values)).bindOrCreate("app.mqtt", MqttProperties.class);
    }

    @Test
    void defaultsAreSafeAndMatchTheIssue() {
        var p = bind(Map.of());
        assertThat(p.enabled()).isFalse();
        assertThat(p.brokerUrl()).isEqualTo("tcp://127.0.0.1:1883");
        assertThat(p.clientId()).isEqualTo("fvm-backend");
        assertThat(p.topicRoot()).isEqualTo("vending");
        assertThat(p.qos()).isEqualTo(1);
        assertThat(p.cleanSession()).isFalse();
        assertThat(p.maxPayloadBytes()).isEqualTo(8192);
        assertThat(p.completionTimeout()).isEqualTo(Duration.ofSeconds(5));
        assertThat(p.maxReconnectDelay()).isEqualTo(Duration.ofSeconds(30));
    }

    @Test
    void invalidValuesFailBinding() {
        for (var invalid : java.util.List.of(Map.of("app.mqtt.qos", "2"), Map.of("app.mqtt.qos", "-1"), Map.of("app.mqtt.broker-url", "http://broker"),
                Map.of("app.mqtt.client-id", "has space"), Map.of("app.mqtt.client-id", ""), Map.of("app.mqtt.topic-root", "vending/+"),
                Map.of("app.mqtt.topic-root", "Vending"), Map.of("app.mqtt.max-payload-bytes", "0"), Map.of("app.mqtt.max-payload-bytes", "999999"),
                Map.of("app.mqtt.completion-timeout", "PT0S"), Map.of("app.mqtt.max-reconnect-delay", "PT0.5S"))) {
            assertThatThrownBy(() -> bind(invalid)).as("%s", invalid).isInstanceOf(RuntimeException.class);
        }
    }

    @Test
    void passwordIsNeverPrintedByTheProperties() {
        var p = bind(Map.of("app.mqtt.username", "fvm-backend", "app.mqtt.password", SECRET));
        assertThat(p.toString()).doesNotContain(SECRET).contains("<redacted>");
        assertThatThrownBy(() -> bind(Map.of("app.mqtt.password", SECRET, "app.mqtt.qos", "7")))
                .satisfies(e -> { for (Throwable t = e; t != null; t = t.getCause()) assertThat(String.valueOf(t.getMessage())).doesNotContain(SECRET); });
    }

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(MqttPropertiesConfig.class, MqttInboundConfig.class)
            .withBean(com.fruitmachine.backend.mqtt.inbound.MqttInboundAdapter.class, () -> org.mockito.Mockito.mock(com.fruitmachine.backend.mqtt.inbound.MqttInboundAdapter.class));

    @Test
    void enabledWithBlankCredentialsFailsStartupWithoutPrintingSecrets() {
        for (String[] credentials : new String[][]{{"", ""}, {"fvm-backend", ""}, {"", SECRET}, {"fvm-backend", "   "}}) {
            runner.withPropertyValues("app.mqtt.enabled=true", "app.mqtt.username=" + credentials[0], "app.mqtt.password=" + credentials[1]).run(context -> {
                assertThat(context).hasFailed();
                Throwable failure = context.getStartupFailure();
                boolean mentionsCredentials = false;
                for (Throwable t = failure; t != null; t = t.getCause()) {
                    assertThat(String.valueOf(t.getMessage())).doesNotContain(SECRET);
                    mentionsCredentials |= String.valueOf(t.getMessage()).contains("MQTT_USERNAME / MQTT_PASSWORD");
                }
                assertThat(mentionsCredentials).isTrue();
            });
        }
    }

    @Test
    void prodProfileRequiresTls() {
        runner.withPropertyValues("app.mqtt.enabled=true", "app.mqtt.username=fvm-backend", "app.mqtt.password=" + SECRET, "spring.profiles.active=prod")
                .run(context -> assertThat(context).hasFailed().getFailure().rootCause().hasMessageContaining("ssl://").message().doesNotContain(SECRET));
    }

    @Test
    void disabledCreatesNoClientAndEnabledCreatesAStoppedAdapter() {
        runner.run(context -> assertThat(context).hasNotFailed().doesNotHaveBean(MqttPahoMessageDrivenChannelAdapter.class));
        runner.withPropertyValues("app.mqtt.enabled=true", "app.mqtt.username=fvm-backend", "app.mqtt.password=" + SECRET).run(context -> {
            assertThat(context).hasNotFailed().hasSingleBean(MqttPahoMessageDrivenChannelAdapter.class);
            var adapter = context.getBean(MqttPahoMessageDrivenChannelAdapter.class);
            // Never started by the context itself: only after ApplicationReadyEvent, on a separate thread.
            assertThat(adapter.isRunning()).isFalse();
            assertThat(adapter.getTopic()).containsExactly("vending/+/telemetry", "vending/+/status", "vending/+/events");
            assertThat(adapter.getQos()).containsExactly(1, 1, 1);
        });
    }
}
