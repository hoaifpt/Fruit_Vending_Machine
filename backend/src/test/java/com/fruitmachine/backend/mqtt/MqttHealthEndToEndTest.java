package com.fruitmachine.backend.mqtt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.utility.MountableFile;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Issue #53 end to end: a real Mosquitto with the repository's broker configuration and ACL (infra/mosquitto), the backend's
 * MQTT gateway, and a client that behaves like the machine (own account, own topics, real Last Will).
 */
class MqttHealthEndToEndTest extends AbstractCoreIntegrationTest {
    static final String MACHINE = "FV-DEV-001";
    // Test-only broker passwords for a disposable container.
    static final String BACKEND_PASSWORD = "test-only-backend-broker", MACHINE_PASSWORD = "test-only-machine-broker";

    @Container
    static final GenericContainer<?> BROKER = new GenericContainer<>("eclipse-mosquitto:2.0.20")
            .withCopyFileToContainer(MountableFile.forHostPath("../infra/mosquitto/mosquitto.conf"), "/mosquitto/config/mosquitto.conf")
            .withCopyFileToContainer(MountableFile.forHostPath("../infra/mosquitto/acl"), "/mosquitto/config/acl")
            .withCommand("sh", "-c", "mosquitto_passwd -b -c /mosquitto/config/passwd backend " + BACKEND_PASSWORD
                    + " && mosquitto_passwd -b /mosquitto/config/passwd " + MACHINE + " " + MACHINE_PASSWORD
                    + " && chown mosquitto:mosquitto /mosquitto/config/passwd /mosquitto/config/acl && chmod 0700 /mosquitto/config/passwd"
                    + " && exec mosquitto -c /mosquitto/config/mosquitto.conf")
            .withExposedPorts(1883);

    @DynamicPropertySource
    static void mqtt(DynamicPropertyRegistry registry) {
        registry.add("app.mqtt.enabled", () -> true);
        registry.add("app.mqtt.broker-url", () -> "tcp://" + BROKER.getHost() + ":" + BROKER.getMappedPort(1883));
        registry.add("app.mqtt.username", () -> "backend");
        registry.add("app.mqtt.password", () -> BACKEND_PASSWORD);
    }

    UUID machine;
    MqttClient device;

    @BeforeEach
    void machineAndDevice() throws Exception {
        // Machines keep their readings (sensor_readings RESTRICT), so an earlier test machine is renamed, not deleted.
        jdbc.update("UPDATE machines SET code = 'OLD-' || id WHERE code = ?", MACHINE);
        machine = fixtures.machine(admin.token());
        jdbc.update("UPDATE machines SET code = ? WHERE id = ?", MACHINE, machine);
        device = connect("device-" + UUID.randomUUID(), null);
    }

    @AfterEach
    void close() throws Exception {
        if (device.isConnected()) device.disconnect();
        device.close();
    }

    MqttClient connect(String clientId, byte[] lastWill) throws Exception {
        var client = new MqttClient("tcp://" + BROKER.getHost() + ":" + BROKER.getMappedPort(1883), clientId, new MemoryPersistence());
        var options = new MqttConnectOptions();
        options.setUserName(MACHINE);
        options.setPassword(MACHINE_PASSWORD.toCharArray());
        options.setCleanSession(true);
        if (lastWill != null) options.setWill("vending/" + MACHINE + "/status", lastWill, 1, false);
        client.connect(options);
        return client;
    }

    static byte[] example(String file) throws Exception {
        return Files.readAllBytes(Path.of("../api-contract/mqtt/examples", file));
    }

    /** The backend connects and subscribes in the background, so the first messages are re-published until they arrive. */
    void publishUntil(String channel, String file, BooleanSupplier arrived) throws Exception {
        Instant deadline = Instant.now().plus(Duration.ofSeconds(30));
        while (!arrived.getAsBoolean()) {
            assertThat(Instant.now()).as("%s reached the backend", file).isBefore(deadline);
            device.publish("vending/" + MACHINE + "/" + channel, new MqttMessage(example(file)));
            Thread.sleep(300);
        }
    }

    JsonNode machineJson() throws Exception {
        return fixtures.api("GET", "/api/v1/machines/" + machine, null, staff.token(), 200);
    }

    @Test
    void heartbeatLastWillAndTelemetryTravelThroughTheBroker() throws Exception {
        publishUntil("heartbeat", "heartbeat.json",
                () -> jdbc.queryForObject("SELECT last_heartbeat_at IS NOT NULL FROM machines WHERE id = ?", Boolean.class, machine));
        var online = machineJson();
        assertThat(online.path("connectivity").asText()).isEqualTo("ONLINE");
        assertThat(online.path("firmwareVersion").asText()).isEqualTo("0.3.0");
        assertThat(online.path("uptimeSeconds").asLong()).isEqualTo(12345);
        assertThat(online.path("wifiRssi").asInt()).isEqualTo(-55);
        assertThat(online.path("freeHeapBytes").asLong()).isEqualTo(18240);

        // A machine that drops off the network: the broker publishes its Last Will (the contract example).
        MqttClient dying = connect("dying-" + UUID.randomUUID(), example("status-offline-lwt.json"));
        dying.disconnectForcibly(1, 1, false);
        dying.close();
        Instant deadline = Instant.now().plus(Duration.ofSeconds(30));
        while (!jdbc.queryForObject("SELECT last_offline_at IS NOT NULL FROM machines WHERE id = ?", Boolean.class, machine)) {
            assertThat(Instant.now()).as("Last Will reached the backend").isBefore(deadline);
            Thread.sleep(200);
        }
        assertThat(machineJson().path("connectivity").asText()).isEqualTo("OFFLINE");

        publishUntil("telemetry", "telemetry.json",
                () -> jdbc.queryForObject("SELECT count(*) FROM sensor_readings WHERE machine_id = ?", Long.class, machine) > 0);
        var latest = fixtures.api("GET", "/api/v1/machines/" + machine + "/telemetry/latest", null, staff.token(), 200);
        assertThat(latest.path("temperature").decimalValue()).isEqualByComparingTo("4.70");
        assertThat(latest.path("humidity").decimalValue()).isEqualByComparingTo("68.20");
        assertThat(latest.path("temperatureStatus").asText()).isEqualTo("NORMAL");
        // The telemetry message counts as a sign of life after the Last Will.
        assertThat(latest.path("connectivity").asText()).isEqualTo("ONLINE");
    }

    @Test
    void theAclKeepsAMachineOnItsOwnTopics() throws Exception {
        UUID other = fixtures.machine(admin.token());
        String otherCode = jdbc.queryForObject("SELECT code FROM machines WHERE id = ?", String.class, other);
        // Wait until the backend is subscribed, using this machine's own heartbeat.
        publishUntil("heartbeat", "heartbeat.json",
                () -> jdbc.queryForObject("SELECT last_heartbeat_at IS NOT NULL FROM machines WHERE id = ?", Boolean.class, machine));
        String forged = new String(example("heartbeat.json")).replace(MACHINE, otherCode);
        for (int i = 0; i < 5; i++) {
            if (!device.isConnected()) break;
            device.publish("vending/" + otherCode + "/heartbeat", new MqttMessage(forged.getBytes()));
            Thread.sleep(200);
        }
        Thread.sleep(1000);
        assertThat(jdbc.queryForObject("SELECT last_seen_at IS NULL FROM machines WHERE id = ?", Boolean.class, other)).isTrue();
    }
}
