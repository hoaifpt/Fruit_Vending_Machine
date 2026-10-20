package com.fruitmachine.backend.mqtt.config;

import java.time.Duration;
import java.util.regex.Pattern;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Inbound MQTT settings ({@code app.mqtt.*}). Disabled by default, so tests and REST-only development never connect.
 * Invalid values fail startup; the password is never part of an error message or {@link #toString()}.
 */
@ConfigurationProperties("app.mqtt")
public record MqttProperties(
        @DefaultValue("false") boolean enabled,
        @DefaultValue("tcp://127.0.0.1:1883") String brokerUrl,
        @DefaultValue("fvm-backend") String clientId,
        String username,
        String password,
        @DefaultValue("vending") String topicRoot,
        @DefaultValue("1") int qos,
        @DefaultValue("false") boolean cleanSession,
        @DefaultValue("8192") int maxPayloadBytes,
        @DefaultValue("PT5S") Duration completionTimeout,
        @DefaultValue("PT30S") Duration maxReconnectDelay) {
    private static final Pattern TOPIC_LEVEL = Pattern.compile("[a-z0-9][a-z0-9_-]{0,31}");
    private static final Pattern CLIENT_ID = Pattern.compile("[A-Za-z0-9._-]{1,64}");
    public static final int MAX_PAYLOAD_LIMIT = 256 * 1024;

    public MqttProperties {
        if (brokerUrl == null || !(brokerUrl.startsWith("tcp://") || brokerUrl.startsWith("ssl://")))
            throw new IllegalArgumentException("app.mqtt.broker-url must start with tcp:// or ssl://");
        if (clientId == null || !CLIENT_ID.matcher(clientId).matches())
            throw new IllegalArgumentException("app.mqtt.client-id must be 1-64 characters [A-Za-z0-9._-]");
        if (topicRoot == null || !TOPIC_LEVEL.matcher(topicRoot).matches())
            throw new IllegalArgumentException("app.mqtt.topic-root must be one lowercase topic level [a-z0-9_-] without wildcards");
        if (qos != 0 && qos != 1) throw new IllegalArgumentException("app.mqtt.qos must be 0 or 1");
        if (maxPayloadBytes < 1 || maxPayloadBytes > MAX_PAYLOAD_LIMIT)
            throw new IllegalArgumentException("app.mqtt.max-payload-bytes must be between 1 and " + MAX_PAYLOAD_LIMIT);
        if (completionTimeout == null || completionTimeout.isZero() || completionTimeout.isNegative())
            throw new IllegalArgumentException("app.mqtt.completion-timeout must be positive");
        if (maxReconnectDelay == null || maxReconnectDelay.toMillis() < 1000 || maxReconnectDelay.toMillis() > Integer.MAX_VALUE)
            throw new IllegalArgumentException("app.mqtt.max-reconnect-delay must be at least 1 second");
    }

    /** Credentials are mandatory only when the client actually connects. */
    public void requireCredentials() {
        if (username == null || username.isBlank() || password == null || password.isBlank())
            throw new IllegalStateException("MQTT is enabled (app.mqtt.enabled=true) but MQTT_USERNAME / MQTT_PASSWORD are not set");
    }

    @Override
    public String toString() {
        return "MqttProperties[enabled=" + enabled + ", brokerUrl=" + brokerUrl + ", clientId=" + clientId + ", username=" + username
                + ", password=" + (password == null || password.isEmpty() ? "<empty>" : "<redacted>") + ", topicRoot=" + topicRoot + ", qos=" + qos
                + ", cleanSession=" + cleanSession + ", maxPayloadBytes=" + maxPayloadBytes + ", completionTimeout=" + completionTimeout
                + ", maxReconnectDelay=" + maxReconnectDelay + "]";
    }
}
