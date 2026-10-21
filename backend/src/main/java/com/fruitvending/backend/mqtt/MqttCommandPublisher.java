package com.fruitvending.backend.mqtt;

import jakarta.annotation.PreDestroy;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

@Component
public class MqttCommandPublisher {

    private final MqttClient client;
    private final MqttConnectOptions connectOptions;

    public MqttCommandPublisher(
            @Value("${mqtt.broker-url:tcp://localhost:1883}") String brokerUrl,
            @Value("${mqtt.username:}") String username,
            @Value("${mqtt.password:}") String password) {
        try {
            client = new MqttClient(brokerUrl, "fruit-vending-backend");
            connectOptions = new MqttConnectOptions();
            connectOptions.setAutomaticReconnect(true);
            connectOptions.setCleanSession(true);
            connectOptions.setConnectionTimeout(5);
            connectOptions.setKeepAliveInterval(30);

            if (!username.isBlank()) {
                connectOptions.setUserName(username);
                connectOptions.setPassword(password.toCharArray());
            }
        } catch (MqttException exception) {
            throw new IllegalStateException("Could not connect to the MQTT broker", exception);
        }
    }

    public void publishCommand(String machineId, String command) throws MqttException {
        if (!client.isConnected()) {
            client.connect(connectOptions);
        }

        String topic = "fruit-vending/" + machineId + "/command";
        MqttMessage message = new MqttMessage(command.getBytes(StandardCharsets.UTF_8));
        message.setQos(1);
        message.setRetained(false);
        client.publish(topic, message);
    }

    @PreDestroy
    public void close() {
        try {
            if (client.isConnected()) {
                client.disconnect();
            }
            client.close();
        } catch (MqttException exception) {
            System.err.println("Could not close MQTT client: " + exception.getMessage());
        }
    }
}
