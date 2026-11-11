package com.fruitmachine.backend.mqtt;

import com.fruitmachine.backend.mqtt.config.MqttProperties;
import java.time.Clock;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.integration.mqtt.event.MqttConnectionFailedEvent;
import org.springframework.integration.mqtt.event.MqttSubscribedEvent;
import org.springframework.stereotype.Component;

/**
 * Connection state of the inbound MQTT client for the application (not part of the public health output, and a disconnected
 * broker never makes the application DOWN). Updated from Spring Integration MQTT events; nothing here contains credentials.
 */
@Component
public class MqttConnectionState {
    private static final Logger log = LoggerFactory.getLogger(MqttConnectionState.class);

    public enum Status { DISABLED, CONNECTING, CONNECTED, DISCONNECTED }

    public record Snapshot(Status status, Instant since, String lastFailure) {}

    private final AtomicReference<Snapshot> current;
    private final Clock clock;

    public MqttConnectionState(MqttProperties properties, Clock clock) {
        this.clock = clock;
        this.current = new AtomicReference<>(new Snapshot(properties.enabled() ? Status.CONNECTING : Status.DISABLED, clock.instant(), null));
    }

    public Snapshot snapshot() {
        return current.get();
    }

    public Status status() {
        return current.get().status();
    }

    @EventListener
    public void onSubscribed(MqttSubscribedEvent event) {
        Snapshot previous = current.getAndSet(new Snapshot(Status.CONNECTED, clock.instant(), null));
        log.info("MQTT connected and subscribed ({})", previous.status() == Status.DISCONNECTED ? "reconnected" : "first connection");
    }

    @EventListener
    public void onConnectionFailed(MqttConnectionFailedEvent event) {
        String failure = describe(event.getCause());
        Snapshot previous = current.getAndSet(new Snapshot(Status.DISCONNECTED, clock.instant(), failure));
        if (previous.status() == Status.CONNECTED) log.warn("MQTT connection lost ({}); retrying", failure);
        else log.warn("MQTT connection attempt failed ({}); retrying", failure);
    }

    /** Exception type and Paho reason code only, never a message that could echo connection options. */
    private static String describe(Throwable cause) {
        if (cause == null) return "unknown";
        for (Throwable t = cause; t != null && t.getCause() != t; t = t.getCause()) {
            if (t instanceof org.eclipse.paho.client.mqttv3.MqttException mqtt) return mqtt.getClass().getSimpleName() + " reason " + mqtt.getReasonCode();
        }
        return cause.getClass().getSimpleName();
    }
}
