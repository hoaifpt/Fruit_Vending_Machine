package com.fruitmachine.backend.mqtt;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fruitmachine.backend.config.properties.MqttProperties;
import com.fruitmachine.backend.dispense.service.MachineCommandGateway;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import lombok.extern.slf4j.Slf4j;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttCallbackExtended;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * MQTT transport (docs/mqtt-dispense.md): publishes dispense commands to {@code <root>/<machineCode>/commands} and subscribes
 * to every machine's {@code events} and {@code status}. Connects in the background and keeps retrying, so the backend starts
 * even when the broker is down; commands created meanwhile stay PENDING and the dispense sweep re-sends them.
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "app.mqtt.enabled", havingValue = "true")
@EnableConfigurationProperties(MqttProperties.class)
public class MqttMachineGateway implements MachineCommandGateway, MqttCallbackExtended {
    private static final int QOS = 1;
    private static final long RETRY_SECONDS = 5;

    private final MqttProperties properties;
    // Lazy: the handler needs DispenseService, which needs this gateway.
    private final ObjectProvider<MachineMessageHandler> handler;
    private final ObjectMapper json;
    private final MqttClient client;
    private final ScheduledExecutorService retry = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "mqtt-connect");
        thread.setDaemon(true);
        return thread;
    });

    public MqttMachineGateway(MqttProperties properties, ObjectProvider<MachineMessageHandler> handler, ObjectMapper json) throws MqttException {
        this.properties = properties;
        this.handler = handler;
        this.json = json;
        // A per-process suffix: two backend processes with the same client id would keep disconnecting each other.
        this.client = new MqttClient(properties.brokerUrl(), properties.clientId() + "-" + UUID.randomUUID().toString().substring(0, 8), new MemoryPersistence());
        this.client.setCallback(this);
    }

    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        retry.execute(this::connect);
    }

    private void connect() {
        if (client.isConnected()) return;
        var options = new MqttConnectOptions();
        options.setAutomaticReconnect(true);
        options.setCleanSession(true);
        options.setConnectionTimeout(10);
        options.setKeepAliveInterval(30);
        if (!properties.username().isBlank()) options.setUserName(properties.username());
        if (!properties.password().isBlank()) options.setPassword(properties.password().toCharArray());
        try {
            client.connect(options);
        } catch (MqttException ex) {
            // Never log the credentials; the reason code is enough (4/5 = bad credentials or not authorised).
            log.warn("MQTT broker {} unreachable (reason {}); retrying in {}s", properties.brokerUrl(), ex.getReasonCode(), RETRY_SECONDS);
            retry.schedule(this::connect, RETRY_SECONDS, TimeUnit.SECONDS);
        }
    }

    @Override
    public void connectComplete(boolean reconnect, String serverUri) {
        // Clean session: subscriptions are lost on every reconnect, so subscribe each time.
        try {
            String root = properties.topicRoot();
            client.subscribe(new String[] {root + "/+/events", root + "/+/status"}, new int[] {QOS, QOS});
            log.info("MQTT {} to {}", reconnect ? "reconnected" : "connected", serverUri);
        } catch (MqttException ex) {
            log.warn("MQTT subscribe failed (reason {})", ex.getReasonCode());
        }
    }

    @Override
    public boolean sendDispense(String machineCode, String commandCode) {
        if (!client.isConnected()) return false;
        try {
            byte[] body = json.writeValueAsBytes(Map.of(
                    "schemaVersion", 1,
                    "messageId", UUID.randomUUID().toString(),
                    "machineCode", machineCode,
                    "payload", Map.of("type", "DISPENSE", "commandId", commandCode)));
            var message = new MqttMessage(body);
            message.setQos(QOS);
            message.setRetained(false);
            client.publish(properties.commandTopic(machineCode), message);
            return true;
        } catch (Exception ex) {
            log.warn("Publishing dispense command {} to {} failed: {}", commandCode, machineCode, ex.getMessage());
            return false;
        }
    }

    @Override
    public void messageArrived(String topic, MqttMessage message) {
        // <root>/<machineCode>/<channel>; never throw here, Paho would drop the connection.
        try {
            String[] parts = topic.split("/");
            if (parts.length != 3) return;
            handler.getObject().handle(parts[1], parts[2], message.getPayload());
        } catch (RuntimeException ex) {
            log.warn("Handling MQTT message on {} failed: {}", topic, ex.getMessage());
            log.debug("MQTT message body: {}", new String(message.getPayload(), StandardCharsets.UTF_8), ex);
        }
    }

    @Override
    public void connectionLost(Throwable cause) {
        log.warn("MQTT connection lost: {}; reconnecting", cause == null ? "unknown" : cause.getMessage());
    }

    @Override
    public void deliveryComplete(IMqttDeliveryToken token) {
        // QoS 1 acknowledgement from the broker; machine results arrive as events.
    }

    @jakarta.annotation.PreDestroy
    void stop() {
        retry.shutdownNow();
        try {
            if (client.isConnected()) client.disconnect(2000);
            client.close();
        } catch (MqttException ex) {
            log.debug("MQTT shutdown: {}", ex.getMessage());
        }
    }
}
