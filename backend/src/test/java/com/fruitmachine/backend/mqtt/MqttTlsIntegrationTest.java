package com.fruitmachine.backend.mqtt;

import com.fasterxml.jackson.databind.JsonNode;
import com.fruitmachine.backend.config.properties.MqttProperties;
import com.fruitmachine.backend.support.AbstractCoreIntegrationTest;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BooleanSupplier;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.utility.MountableFile;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

/**
 * Issue #59: the staging broker configuration (infra/mosquitto/mosquitto.staging.conf) with the test-only certificates of
 * src/test/resources/mqtt-tls. The backend talks to it over ssl:// with a private-CA truststore and hostname verification; untrusted
 * certificates and wrong hostnames are refused while the retry loop keeps running; plaintext 1883 is not reachable from outside.
 */
@ExtendWith(OutputCaptureExtension.class)
class MqttTlsIntegrationTest extends AbstractCoreIntegrationTest {
    static final String MACHINE = "FV-DEV-001";
    // Test-only broker and truststore passwords for a disposable container.
    static final String BACKEND_PASSWORD = "test-only-tls-backend-broker", MACHINE_PASSWORD = "test-only-tls-machine-broker";
    static final String TRUST_PASSWORD = "test-only-truststore";
    static final Path TLS = Path.of("src/test/resources/mqtt-tls").toAbsolutePath();
    static final String TRUSTSTORE = TLS.resolve("truststore.p12").toString(), UNTRUSTED = TLS.resolve("untrusted-truststore.p12").toString();

    static MountableFile file(String path) {
        return MountableFile.forHostPath(path, 0644);
    }

    @Container
    static final GenericContainer<?> BROKER = new GenericContainer<>("eclipse-mosquitto:2.0.20")
            .withCopyFileToContainer(file("../infra/mosquitto/mosquitto.staging.conf"), "/mosquitto/config/staging.conf")
            .withCopyFileToContainer(file("../infra/mosquitto/acl"), "/mosquitto/config/acl")
            .withCopyFileToContainer(file(TLS.resolve("broker.pem").toString()), "/mosquitto/certs/fullchain.pem")
            .withCopyFileToContainer(file(TLS.resolve("broker.key").toString()), "/mosquitto/certs/privkey.pem")
            .withCopyFileToContainer(file(TLS.resolve("wrong-host.pem").toString()), "/mosquitto/certs/wrong-host.pem")
            .withCopyFileToContainer(file(TLS.resolve("wrong-host.key").toString()), "/mosquitto/certs/wrong-host.key")
            // The staging file as committed, plus one test-only listener whose certificate names another host.
            .withCommand("sh", "-c", "cp /mosquitto/config/staging.conf /mosquitto/config/mosquitto.conf"
                    + " && printf 'listener 8884 0.0.0.0\\ncertfile /mosquitto/certs/wrong-host.pem\\nkeyfile /mosquitto/certs/wrong-host.key\\ntls_version tlsv1.2\\n'"
                    + " >> /mosquitto/config/mosquitto.conf"
                    + " && mosquitto_passwd -b -c /mosquitto/config/passwd backend " + BACKEND_PASSWORD
                    + " && mosquitto_passwd -b /mosquitto/config/passwd " + MACHINE + " " + MACHINE_PASSWORD
                    + " && chown -R mosquitto:mosquitto /mosquitto/config /mosquitto/certs && chmod 0700 /mosquitto/config/passwd"
                    + " && chmod 0640 /mosquitto/certs/privkey.pem /mosquitto/certs/wrong-host.key"
                    + " && exec mosquitto -c /mosquitto/config/mosquitto.conf")
            .withExposedPorts(8883, 8884, 1883)
            // 1883 listens on the container loopback only: wait for the TLS listeners, not every exposed port.
            .waitingFor(Wait.forListeningPorts(8883, 8884));

    static String url(String scheme, int port) {
        return scheme + BROKER.getHost() + ":" + BROKER.getMappedPort(port);
    }

    @DynamicPropertySource
    static void mqtt(DynamicPropertyRegistry registry) {
        registry.add("app.mqtt.enabled", () -> true);
        registry.add("app.mqtt.broker-url", () -> url("ssl://", 8883));
        registry.add("app.mqtt.require-tls", () -> true);
        registry.add("app.mqtt.username", () -> "backend");
        registry.add("app.mqtt.password", () -> BACKEND_PASSWORD);
        registry.add("app.mqtt.truststore-path", () -> TRUSTSTORE);
        registry.add("app.mqtt.truststore-password", () -> TRUST_PASSWORD);
    }

    @Autowired MqttMachineGateway gateway;
    UUID machine;
    MqttClient device;
    final List<MqttMessage> commands = new CopyOnWriteArrayList<>();

    @BeforeEach
    void machineAndDevice() throws Exception {
        // Machines keep their readings (sensor_readings RESTRICT), so an earlier test machine is renamed, not deleted.
        jdbc.update("UPDATE machines SET code = 'OLD-' || id WHERE code = ?", MACHINE);
        machine = fixtures.machine(admin.token());
        jdbc.update("UPDATE machines SET code = ? WHERE id = ?", MACHINE, machine);
        device = device(url("ssl://", 8883), MACHINE_PASSWORD);
        device.subscribe("vending/" + MACHINE + "/commands", 1, (topic, message) -> commands.add(message));
    }

    @AfterEach
    void close() throws Exception {
        if (device.isConnected()) device.disconnect();
        device.close();
    }

    /** A machine client over TLS, like the ESP32 with WiFiClientSecure + the CA certificate. */
    static MqttClient device(String brokerUrl, String password) throws Exception {
        var client = new MqttClient(brokerUrl, "device-" + UUID.randomUUID(), new MemoryPersistence());
        var options = new MqttConnectOptions();
        options.setUserName(MACHINE);
        options.setPassword(password.toCharArray());
        options.setCleanSession(true);
        options.setConnectionTimeout(10);
        if (brokerUrl.startsWith("ssl://")) {
            options.setSocketFactory(MqttTlsSocketFactory.create(TRUSTSTORE, TRUST_PASSWORD));
            options.setHttpsHostnameVerificationEnabled(true);
        }
        client.connect(options);
        return client;
    }

    void publishUntil(String channel, String file, BooleanSupplier arrived) throws Exception {
        Instant deadline = Instant.now().plus(Duration.ofSeconds(30));
        while (!arrived.getAsBoolean()) {
            assertThat(Instant.now()).as("%s reached the backend over TLS", file).isBefore(deadline);
            device.publish("vending/" + MACHINE + "/" + channel, new MqttMessage(Files.readAllBytes(Path.of("../api-contract/mqtt/examples", file))));
            Thread.sleep(300);
        }
    }

    static void waitFor(String what, BooleanSupplier condition) throws InterruptedException {
        Instant deadline = Instant.now().plus(Duration.ofSeconds(30));
        while (!condition.getAsBoolean()) {
            assertThat(Instant.now()).as(what).isBefore(deadline);
            Thread.sleep(200);
        }
    }

    static void assertNoSecrets(CapturedOutput output) {
        assertThat(output.getAll()).doesNotContain(BACKEND_PASSWORD, MACHINE_PASSWORD, TRUST_PASSWORD);
    }

    MqttMachineGateway gatewayTo(String brokerUrl, String truststore) throws Exception {
        @SuppressWarnings("unchecked")
        ObjectProvider<MachineMessageHandler> handler = mock(ObjectProvider.class);
        var properties = new MqttProperties(true, brokerUrl, "tls-test", "backend", BACKEND_PASSWORD, "vending", true, truststore, TRUST_PASSWORD);
        return new MqttMachineGateway(properties, handler, json);
    }

    @Test
    void theBackendSubscribesPublishesAndReceivesOverTls(CapturedOutput output) throws Exception {
        publishUntil("heartbeat", "heartbeat.json",
                () -> jdbc.queryForObject("SELECT last_heartbeat_at IS NOT NULL FROM machines WHERE id = ?", Boolean.class, machine));
        assertThat(gateway.isConnected()).isTrue();
        publishUntil("events", "event-boot.json",
                () -> jdbc.queryForObject("SELECT count(*) FROM machine_events WHERE machine_id = ? AND event_type = 'BOOT'", Long.class, machine) > 0);

        assertThat(gateway.sendDispense(MACHINE, "D-7F3A91C2E4B05D18", "A")).isTrue();
        waitFor("DISPENSE reached the machine over TLS", () -> !commands.isEmpty());
        JsonNode command = json.readTree(new String(commands.getFirst().getPayload(), StandardCharsets.UTF_8));
        assertThat(command.at("/payload/type").asText()).isEqualTo("DISPENSE");
        assertThat(command.at("/payload/commandId").asText()).isEqualTo("D-7F3A91C2E4B05D18");
        assertThat(command.at("/payload/columnCode").asText()).isEqualTo("A");
        assertNoSecrets(output);
    }

    @Test
    void anUntrustedCaIsRefusedAndTheRetryLoopKeepsRunning(CapturedOutput output) throws Exception {
        var untrusted = gatewayTo(url("ssl://", 8883), UNTRUSTED);
        try {
            untrusted.start();
            // Two failures: the retry loop survived the first one (retry every 5 s).
            Instant deadline = Instant.now().plus(Duration.ofSeconds(30));
            while (output.getAll().split("MQTT TLS connection to ssl://", -1).length - 1 < 2) {
                assertThat(Instant.now()).as("two TLS failures logged").isBefore(deadline);
                Thread.sleep(200);
            }
            assertThat(untrusted.isConnected()).isFalse();
            assertThat(output.getAll()).contains("WARN").containsPattern("MQTT TLS connection to ssl://\\S+ failed: SSLHandshakeException: .*(PKIX|certification path)");
        } finally {
            untrusted.stop();
        }
        // The application's own gateway is unaffected.
        assertThat(gateway.isConnected()).isTrue();
        assertNoSecrets(output);
    }

    @Test
    void aCertificateForAnotherHostIsRefused(CapturedOutput output) throws Exception {
        // Port 8884 presents a certificate from the trusted test CA, but for mqtt.wrong-host.invalid only.
        var mismatch = gatewayTo(url("ssl://", 8884), TRUSTSTORE);
        try {
            mismatch.start();
            waitFor("hostname mismatch logged", () -> output.getAll().contains("MQTT TLS connection to ssl://"));
            assertThat(mismatch.isConnected()).isFalse();
            assertThat(output.getAll()).containsPattern("(?i)failed: .*(subject alternative|hostname|No name matching)");
        } finally {
            mismatch.stop();
        }
        assertThatThrownBy(() -> device(url("ssl://", 8884), MACHINE_PASSWORD)).isInstanceOf(MqttException.class);
        assertNoSecrets(output);
    }

    @Test
    void plaintextAndWrongPasswordsAreRefused() {
        // The staging 1883 listener is bound to the container loopback: unreachable through the published port.
        assertThatThrownBy(() -> device(url("tcp://", 1883), MACHINE_PASSWORD)).isInstanceOf(MqttException.class);
        // Plaintext MQTT against the TLS port is not MQTT.
        assertThatThrownBy(() -> device(url("tcp://", 8883), MACHINE_PASSWORD)).isInstanceOf(MqttException.class);
        assertThatThrownBy(() -> device(url("ssl://", 8883), "test-only-wrong-password"))
                .isInstanceOfSatisfying(MqttException.class, ex -> assertThat(ex.getReasonCode())
                        .isIn((int) MqttException.REASON_CODE_FAILED_AUTHENTICATION, (int) MqttException.REASON_CODE_NOT_AUTHORIZED));
    }
}
