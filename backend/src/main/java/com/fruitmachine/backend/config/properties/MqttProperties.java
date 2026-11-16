package com.fruitmachine.backend.config.properties;

import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.Locale;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Broker connection for dispense commands and machine events (api-contract/mqtt-contract.md). Disabled by default: without a broker
 * the backend still creates dispense commands, which stay PENDING and time out.
 *
 * <p>Issue #59: {@code ssl://} URLs use TLS 1.2+ with hostname verification; {@code require-tls} (staging) refuses anything else at
 * startup. {@code truststore-path} (PKCS12) is only for a private CA; empty means the JVM trust store (Let's Encrypt).
 * The broker and truststore passwords never appear in {@link #toString()}, logs or error messages.
 */
@ConfigurationProperties("app.mqtt")
public record MqttProperties(
        @DefaultValue("false") boolean enabled,
        @DefaultValue("tcp://127.0.0.1:1883") String brokerUrl,
        @DefaultValue("fruit-backend") String clientId,
        @DefaultValue("") String username,
        @DefaultValue("") String password,
        @DefaultValue("vending") String topicRoot,
        @DefaultValue("false") boolean requireTls,
        @DefaultValue("") String truststorePath,
        @DefaultValue("") String truststorePassword) {
    public static final String TCP = "tcp://", SSL = "ssl://";

    public MqttProperties {
        username = username == null ? "" : username;
        password = password == null ? "" : password;
        truststorePath = truststorePath == null ? "" : truststorePath.strip();
        truststorePassword = truststorePassword == null ? "" : truststorePassword;
        if (enabled && (brokerUrl == null || brokerUrl.isBlank())) throw new IllegalArgumentException("app.mqtt.broker-url is required when MQTT is enabled");
        if (brokerUrl != null && !brokerUrl.isBlank()) {
            String scheme = brokerUrl.strip().toLowerCase(Locale.ROOT);
            // The URL itself is not echoed: a misconfigured value could carry credentials.
            if (!scheme.startsWith(TCP) && !scheme.startsWith(SSL)) throw new IllegalArgumentException("app.mqtt.broker-url must start with tcp:// or ssl://");
        }
        if (requireTls && (brokerUrl == null || !brokerUrl.strip().toLowerCase(Locale.ROOT).startsWith(SSL)))
            throw new IllegalArgumentException("app.mqtt.require-tls is true but app.mqtt.broker-url is not ssl://; refusing to use MQTT without TLS");
        if (!truststorePath.isEmpty()) {
            Path file;
            try {
                file = Path.of(truststorePath);
            } catch (InvalidPathException ex) {
                throw new IllegalArgumentException("app.mqtt.truststore-path is not a valid path");
            }
            if (!Files.isRegularFile(file) || !Files.isReadable(file))
                throw new IllegalArgumentException("app.mqtt.truststore-path does not point to a readable file: " + truststorePath);
        }
        if (topicRoot == null || topicRoot.isBlank() || topicRoot.contains("/") || topicRoot.contains("+") || topicRoot.contains("#"))
            throw new IllegalArgumentException("app.mqtt.topic-root must be one topic level");
    }

    public boolean tls() {
        return brokerUrl != null && brokerUrl.strip().toLowerCase(Locale.ROOT).startsWith(SSL);
    }

    public String commandTopic(String machineCode) {
        return com.fruitmachine.backend.mqtt.contract.MachineTopic.of(topicRoot, machineCode, com.fruitmachine.backend.mqtt.contract.MachineChannel.COMMANDS);
    }

    /** Secrets masked: records print every component by default. */
    @Override
    public String toString() {
        return "MqttProperties[enabled=" + enabled + ", brokerUrl=" + brokerUrl + ", clientId=" + clientId + ", username=" + username
                + ", password=" + mask(password) + ", topicRoot=" + topicRoot + ", requireTls=" + requireTls + ", truststorePath=" + truststorePath
                + ", truststorePassword=" + mask(truststorePassword) + "]";
    }

    private static String mask(String secret) {
        return secret.isEmpty() ? "" : "****";
    }
}
