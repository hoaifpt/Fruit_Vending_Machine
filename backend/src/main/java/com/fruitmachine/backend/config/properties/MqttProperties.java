package com.fruitmachine.backend.config.properties;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Broker connection for dispense commands and machine events (docs/mqtt-dispense.md). Disabled by default: without a broker
 * the backend still creates dispense commands, which stay PENDING and time out.
 */
@ConfigurationProperties("app.mqtt")
public record MqttProperties(
        @DefaultValue("false") boolean enabled,
        @DefaultValue("tcp://127.0.0.1:1883") String brokerUrl,
        @DefaultValue("fruit-backend") String clientId,
        @DefaultValue("") String username,
        @DefaultValue("") String password,
        @DefaultValue("vending") String topicRoot) {
    public MqttProperties {
        if (enabled && (brokerUrl == null || brokerUrl.isBlank())) throw new IllegalArgumentException("app.mqtt.broker-url is required when MQTT is enabled");
        if (topicRoot == null || topicRoot.isBlank() || topicRoot.contains("/") || topicRoot.contains("+") || topicRoot.contains("#"))
            throw new IllegalArgumentException("app.mqtt.topic-root must be one topic level");
    }

    public String commandTopic(String machineCode) {
        return topicRoot + "/" + machineCode + "/commands";
    }
}
