package com.fruitmachine.backend.mqtt;

import com.fruitmachine.backend.config.properties.MqttProperties;
import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.SSLSocket;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Issue #59: MQTT TLS settings are validated at startup, never leak secrets, and the socket factory allows TLS 1.2+ only. */
class MqttTlsPropertiesTest {
    static final String BROKER_PASSWORD = "test-only-broker-secret-59", TRUST_PASSWORD = "test-only-truststore";
    static final String TRUSTSTORE = Path.of("src/test/resources/mqtt-tls/truststore.p12").toAbsolutePath().toString();

    static MqttProperties properties(String url, boolean requireTls, String truststore) {
        return new MqttProperties(true, url, "fruit-backend", "backend", BROKER_PASSWORD, "vending", requireTls, truststore, TRUST_PASSWORD);
    }

    @Configuration
    @EnableConfigurationProperties(MqttProperties.class)
    static class Binding { }

    @Test
    void requireTlsRefusesAPlaintextBrokerUrlAtStartup() {
        assertThatThrownBy(() -> properties("tcp://mqtt.example.invalid:1883", true, ""))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("require-tls").hasMessageContaining("ssl://");
        new ApplicationContextRunner().withUserConfiguration(Binding.class)
                .withPropertyValues("app.mqtt.enabled=true", "app.mqtt.broker-url=tcp://mqtt.example.invalid:1883", "app.mqtt.require-tls=true",
                        "app.mqtt.password=" + BROKER_PASSWORD, "app.mqtt.truststore-password=" + TRUST_PASSWORD)
                .run(context -> {
                    assertThat(context).hasFailed();
                    Throwable failure = context.getStartupFailure();
                    assertThat(failure).rootCause().hasMessageContaining("refusing to use MQTT without TLS");
                    for (Throwable t = failure; t != null; t = t.getCause())
                        assertThat(String.valueOf(t.getMessage())).doesNotContain(BROKER_PASSWORD, TRUST_PASSWORD);
                });
        // Local development keeps working: tcp:// without require-tls.
        assertThat(properties("tcp://127.0.0.1:1883", false, "").tls()).isFalse();
        assertThat(properties("ssl://mqtt.example.invalid:8883", true, "").tls()).isTrue();
        assertThat(properties("SSL://mqtt.example.invalid:8883", true, "").tls()).isTrue();
    }

    @Test
    void unknownSchemesAndMissingTruststoresAreRejected() {
        for (String url : List.of("ws://mqtt.example.invalid:8080", "mqtt.example.invalid:1883", "wss://mqtt.example.invalid", "local://broker"))
            assertThatThrownBy(() -> properties(url, false, "")).as(url).isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("app.mqtt.broker-url must start with tcp:// or ssl://");
        assertThatThrownBy(() -> properties("ssl://mqtt.example.invalid:8883", true, "src/test/resources/mqtt-tls/missing.p12"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("truststore-path does not point to a readable file");
        assertThatThrownBy(() -> properties("ssl://mqtt.example.invalid:8883", true, "src/test/resources/mqtt-tls"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("readable file");
        assertThat(properties("ssl://mqtt.example.invalid:8883", true, TRUSTSTORE).truststorePath()).isEqualTo(TRUSTSTORE);
    }

    @Test
    void secretsNeverAppearInToString() {
        String text = properties("ssl://mqtt.example.invalid:8883", true, TRUSTSTORE).toString();
        assertThat(text).doesNotContain(BROKER_PASSWORD, TRUST_PASSWORD).contains("password=****", "truststorePassword=****", "requireTls=true");
    }

    @Test
    void socketsAllowOnlyTls12AndTls13() throws IOException {
        var factory = MqttTlsSocketFactory.create(TRUSTSTORE, TRUST_PASSWORD);
        assertThat(factory.protocols()).isNotEmpty().isSubsetOf("TLSv1.3", "TLSv1.2");
        try (var socket = (SSLSocket) factory.createSocket()) {
            assertThat(socket.getEnabledProtocols()).isNotEmpty().allMatch(p -> p.equals("TLSv1.3") || p.equals("TLSv1.2"));
        }
        // JVM default trust store (Let's Encrypt) when no truststore is configured.
        assertThat(MqttTlsSocketFactory.create("", "").protocols()).contains("TLSv1.2");
    }

    @Test
    void aWrongTruststorePasswordFailsWithoutRevealingIt() {
        String wrong = "test-only-wrong-truststore-password";
        assertThatThrownBy(() -> MqttTlsSocketFactory.create(TRUSTSTORE, wrong))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("PKCS12").satisfies(ex -> assertThat(ex.getMessage()).doesNotContain(wrong));
    }

    @Test
    void tlsFailuresAreRecognisedInTheCauseChain() {
        var handshake = new MqttException(0, new SSLHandshakeException("PKIX path building failed"));
        assertThat(MqttMachineGateway.tlsFailure(handshake)).isEqualTo("SSLHandshakeException: PKIX path building failed");
        assertThat(MqttMachineGateway.tlsFailure(new MqttException(MqttException.REASON_CODE_FAILED_AUTHENTICATION))).isNull();
    }
}
