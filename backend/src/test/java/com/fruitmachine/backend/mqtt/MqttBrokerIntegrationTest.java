package com.fruitmachine.backend.mqtt;

import com.fruitmachine.backend.mqtt.message.MachineChannel;
import com.fruitmachine.backend.mqtt.message.MachineMessage;
import com.fruitmachine.backend.mqtt.message.MachineMessageHandler;
import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttSecurityException;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.utility.MountableFile;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

/**
 * Real Mosquitto (the committed infra/mosquitto mosquitto.conf and ACL, with a password file generated for this run) and real
 * PostgreSQL. Passwords are random per run and must never appear in the log output.
 */
@ExtendWith(OutputCaptureExtension.class)
@Import(MqttBrokerIntegrationTest.Handlers.class)
class MqttBrokerIntegrationTest extends AbstractCoreIntegrationTest {
    static final String BACKEND_PASSWORD = "be-" + UUID.randomUUID();
    static final String MACHINE_A = "FV-IT-A", MACHINE_B = "FV-IT-B";
    static final String PASSWORD_A = "a-" + UUID.randomUUID(), PASSWORD_B = "b-" + UUID.randomUUID();
    static final BlockingQueue<MachineMessage> RECEIVED = new LinkedBlockingQueue<>();

    /** Broker restarts in place (same port) when its process is killed, so reconnect can be tested. */
    @Container
    static final GenericContainer<?> MOSQUITTO = new GenericContainer<>("eclipse-mosquitto:2")
            .withExposedPorts(1883)
            .withCopyFileToContainer(MountableFile.forHostPath("../infra/mosquitto/config/mosquitto.conf"), "/mosquitto/config/mosquitto.conf")
            .withCopyFileToContainer(MountableFile.forHostPath("../infra/mosquitto/config/acl"), "/mosquitto/config/acl")
            .withEnv(Map.of("BE_PW", BACKEND_PASSWORD, "A_PW", PASSWORD_A, "B_PW", PASSWORD_B))
            .withCommand("sh", "-c", String.join(" && ",
                    "touch /mosquitto/config/passwd",
                    "mosquitto_passwd -b /mosquitto/config/passwd fvm-backend \"$BE_PW\"",
                    "mosquitto_passwd -b /mosquitto/config/passwd " + MACHINE_A + " \"$A_PW\"",
                    "mosquitto_passwd -b /mosquitto/config/passwd " + MACHINE_B + " \"$B_PW\"",
                    "chown mosquitto:mosquitto /mosquitto/config/passwd /mosquitto/config/acl",
                    "chmod 0700 /mosquitto/config/passwd /mosquitto/config/acl",
                    "while true; do mosquitto -c /mosquitto/config/mosquitto.conf; sleep 0.2; done"))
            .waitingFor(Wait.forLogMessage(".*mosquitto version .* running.*", 1));

    @DynamicPropertySource
    static void mqttProperties(DynamicPropertyRegistry registry) {
        registry.add("app.mqtt.enabled", () -> "true");
        registry.add("app.mqtt.broker-url", () -> "tcp://" + MOSQUITTO.getHost() + ":" + MOSQUITTO.getMappedPort(1883));
        registry.add("app.mqtt.client-id", () -> "fvm-backend-it-" + UUID.randomUUID().toString().substring(0, 8));
        registry.add("app.mqtt.username", () -> "fvm-backend");
        registry.add("app.mqtt.password", () -> BACKEND_PASSWORD);
        registry.add("app.mqtt.max-reconnect-delay", () -> "PT2S");
    }

    @TestConfiguration
    static class Handlers {
        @Bean MachineMessageHandler telemetryHandler() { return handler(MachineChannel.TELEMETRY); }
        @Bean MachineMessageHandler statusHandler() { return handler(MachineChannel.STATUS); }
        @Bean MachineMessageHandler eventHandler() { return handler(MachineChannel.EVENT); }

        private static MachineMessageHandler handler(MachineChannel channel) {
            return new MachineMessageHandler() {
                @Override public MachineChannel channel() { return channel; }
                @Override public void handle(MachineMessage message) {
                    if (message.messageId().startsWith("throw")) throw new IllegalStateException("test handler failure");
                    RECEIVED.add(message);
                }
            };
        }
    }

    @Autowired MqttConnectionState state;
    @Autowired MqttMetrics metrics;

    @BeforeEach
    void machinesAndConnection() throws Exception {
        for (String code : new String[]{MACHINE_A, MACHINE_B}) {
            if (jdbc.queryForObject("SELECT count(*) FROM machines WHERE code=?", Long.class, code) == 0) {
                fixtures.api("POST", "/api/v1/machines", Map.of("code", code, "name", "MQTT " + code, "location", "IT",
                        "minTemperature", 2, "maxTemperature", 8, "minHumidity", 40, "maxHumidity", 80), admin.token(), 201);
            }
        }
        await().atMost(Duration.ofSeconds(30)).until(() -> state.status() == MqttConnectionState.Status.CONNECTED);
        RECEIVED.clear();
    }

    static MqttClient machine(String code, String password) throws MqttException {
        var client = new MqttClient("tcp://" + MOSQUITTO.getHost() + ":" + MOSQUITTO.getMappedPort(1883), code + "-" + UUID.randomUUID().toString().substring(0, 6),
                new MemoryPersistence());
        var options = new MqttConnectOptions();
        options.setCleanSession(true);
        if (code != null) options.setUserName(code);
        if (password != null) options.setPassword(password.toCharArray());
        options.setConnectionTimeout(10);
        client.connect(options);
        return client;
    }

    static String envelope(String code, String messageId, String payload) {
        return "{\"schemaVersion\":1,\"messageId\":\"" + messageId + "\",\"machineCode\":\"" + code + "\",\"sentAt\":\"2026-10-20T00:05:00Z\",\"payload\":" + payload + "}";
    }

    static void publish(MqttClient client, String topic, String body) throws MqttException {
        client.publish(topic, body.getBytes(StandardCharsets.UTF_8), 1, false);
    }

    static MachineMessage next() throws InterruptedException {
        MachineMessage message = RECEIVED.poll(15, TimeUnit.SECONDS);
        assertThat(message).as("message delivered to a handler").isNotNull();
        return message;
    }

    UUID machineId(String code) {
        return jdbc.queryForObject("SELECT id FROM machines WHERE code=?", UUID.class, code);
    }

    @Test
    void backendConnectsAndEveryChannelReachesItsHandler(CapturedOutput output) throws Exception {
        assertThat(state.snapshot().lastFailure()).isNull();
        var client = machine(MACHINE_A, PASSWORD_A);
        try {
            Instant before = Instant.now();
            publish(client, "vending/" + MACHINE_A + "/telemetry", envelope(MACHINE_A, "tel-1", "{\"temperature\":4.7,\"humidity\":68.2}"));
            publish(client, "vending/" + MACHINE_A + "/status", envelope(MACHINE_A, "sta-1", "{\"state\":\"ONLINE\",\"firmwareVersion\":\"1.0.3\",\"uptimeSeconds\":3600}"));
            publish(client, "vending/" + MACHINE_A + "/events", envelope(MACHINE_A, "evt-1", "{\"eventType\":\"DOOR_OPENED\",\"details\":{}}"));
            var telemetry = next();
            assertThat(telemetry.channel()).isEqualTo(MachineChannel.TELEMETRY);
            assertThat(telemetry.machineId()).isEqualTo(machineId(MACHINE_A));
            assertThat(telemetry.machineCode()).isEqualTo(MACHINE_A);
            assertThat(telemetry.messageId()).isEqualTo("tel-1");
            assertThat(telemetry.sentAt()).isEqualTo(Instant.parse("2026-10-20T00:05:00Z"));
            assertThat(telemetry.receivedAt()).isAfterOrEqualTo(before.minusSeconds(1));
            assertThat(telemetry.payload().path("humidity").asDouble()).isEqualTo(68.2);
            var status = next();
            assertThat(status.channel()).isEqualTo(MachineChannel.STATUS);
            assertThat(status.payload().path("state").asText()).isEqualTo("ONLINE");
            var event = next();
            assertThat(event.channel()).isEqualTo(MachineChannel.EVENT);
            assertThat(event.payload().path("eventType").asText()).isEqualTo("DOOR_OPENED");
        } finally {
            client.disconnect();
            client.close();
        }
        // The connect log line may precede this test's output capture; the connection itself is asserted through MqttConnectionState.
        assertThat(state.status()).isEqualTo(MqttConnectionState.Status.CONNECTED);
        assertThat(output).doesNotContain(BACKEND_PASSWORD, PASSWORD_A, PASSWORD_B);
    }

    @Test
    void unknownMachinesAndInvalidMessagesAreDroppedWithoutStoppingLaterMessages(CapturedOutput output) throws Exception {
        // A broker account whose machine is not registered in the backend.
        jdbc.update("UPDATE machines SET code='FV-IT-B-RENAMED' WHERE code=?", MACHINE_B);
        double unknown = metrics.count(MqttMetrics.REJECTED, "reason", "UNKNOWN_MACHINE");
        try {
            var b = machine(MACHINE_B, PASSWORD_B);
            publish(b, "vending/" + MACHINE_B + "/telemetry", envelope(MACHINE_B, "unknown-1", "{}"));
            b.disconnect();
            b.close();
            var a = machine(MACHINE_A, PASSWORD_A);
            publish(a, "vending/" + MACHINE_A + "/telemetry", "not json at all");
            publish(a, "vending/" + MACHINE_A + "/telemetry", envelope(MACHINE_B, "mismatch-1", "{}"));
            publish(a, "vending/" + MACHINE_A + "/telemetry", envelope(MACHINE_A, "throw-1", "{}"));
            publish(a, "vending/" + MACHINE_A + "/telemetry", "{\"schemaVersion\":2,\"messageId\":\"v2\",\"machineCode\":\"" + MACHINE_A + "\",\"payload\":{}}");
            publish(a, "vending/" + MACHINE_A + "/telemetry", envelope(MACHINE_A, "valid-after", "{\"temperature\":5}"));
            assertThat(next().messageId()).isEqualTo("valid-after");
            a.disconnect();
            a.close();
        } finally {
            jdbc.update("UPDATE machines SET code=? WHERE code='FV-IT-B-RENAMED'", MACHINE_B);
        }
        assertThat(RECEIVED).isEmpty();
        assertThat(metrics.count(MqttMetrics.REJECTED, "reason", "UNKNOWN_MACHINE")).isEqualTo(unknown + 1);
        assertThat(output).contains("reason=UNKNOWN_MACHINE", "unknown-1", "reason=INVALID_JSON", "reason=MACHINE_CODE_MISMATCH",
                "reason=UNSUPPORTED_SCHEMA_VERSION", "throw-1").doesNotContain("not json at all", BACKEND_PASSWORD, PASSWORD_A, PASSWORD_B);
        assertThat(state.status()).isEqualTo(MqttConnectionState.Status.CONNECTED);
    }

    @Test
    void brokerDeniesAnonymousClientsWrongPasswordsAndCrossMachinePublishing() throws Exception {
        assertThatThrownBy(() -> machine(null, null)).isInstanceOf(MqttSecurityException.class);
        assertThatThrownBy(() -> machine(MACHINE_A, "wrong-password")).isInstanceOf(MqttSecurityException.class);
        var a = machine(MACHINE_A, PASSWORD_A);
        try {
            // ACL: machine A may publish only its own channels; anything else is dropped silently by the broker (MQTT 3.1.1).
            publish(a, "vending/" + MACHINE_B + "/telemetry", envelope(MACHINE_B, "spoofed-by-a", "{}"));
            publish(a, "vending/" + MACHINE_A + "/commands", envelope(MACHINE_A, "no-command-topic", "{}"));
            publish(a, "vending/" + MACHINE_A + "/telemetry", envelope(MACHINE_A, "own-topic", "{}"));
            assertThat(next().messageId()).isEqualTo("own-topic");
            assertThat(RECEIVED.poll(1, TimeUnit.SECONDS)).isNull();
        } finally {
            a.disconnect();
            a.close();
        }
    }

    @Test
    void reconnectsAfterABrokerRestartAndReceivesAgain(CapturedOutput output) throws Exception {
        MOSQUITTO.execInContainer("sh", "-c", "kill $(pidof mosquitto)");
        await().atMost(Duration.ofSeconds(20)).until(() -> state.status() == MqttConnectionState.Status.DISCONNECTED);
        await().atMost(Duration.ofSeconds(30)).until(() -> state.status() == MqttConnectionState.Status.CONNECTED);
        var a = machine(MACHINE_A, PASSWORD_A);
        try {
            publish(a, "vending/" + MACHINE_A + "/events", envelope(MACHINE_A, "after-restart", "{\"eventType\":\"FIRMWARE_UPDATED\",\"details\":{}}"));
            assertThat(next().messageId()).isEqualTo("after-restart");
        } finally {
            a.disconnect();
            a.close();
        }
        assertThat(output).contains("MQTT connection lost", "reconnected").doesNotContain(BACKEND_PASSWORD);
    }

    @Test
    void restApiKeepsWorkingAndHealthHidesMqttDetails() throws Exception {
        var health = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/actuator/health")).andReturn().getResponse();
        assertThat(health.getStatus()).isEqualTo(200);
        assertThat(health.getContentAsString()).doesNotContainIgnoringCase("mqtt");
        assertThat(fixtures.api("GET", "/api/v1/machines?size=1", null, admin.token(), 200).path("content").isArray()).isTrue();
    }
}
