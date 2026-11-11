package com.fruitmachine.backend.mqtt;

import com.fruitmachine.backend.mqtt.inbound.RejectionReason;
import com.fruitmachine.backend.mqtt.message.MachineChannel;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

/** In-process Micrometer counters of the inbound pipeline; not exposed through the public health endpoint. */
@Component
public class MqttMetrics {
    public static final String RECEIVED = "fvm.mqtt.messages.received";
    public static final String ACCEPTED = "fvm.mqtt.messages.accepted";
    public static final String REJECTED = "fvm.mqtt.messages.rejected";
    public static final String UNHANDLED = "fvm.mqtt.messages.unhandled";
    public static final String HANDLER_ERRORS = "fvm.mqtt.handler.errors";

    private final MeterRegistry registry;

    public MqttMetrics(ObjectProvider<MeterRegistry> registry) {
        this.registry = registry.getIfAvailable(SimpleMeterRegistry::new);
    }

    public void received() {
        registry.counter(RECEIVED).increment();
    }

    public void accepted(MachineChannel channel) {
        registry.counter(ACCEPTED, "channel", channel.topicLevel()).increment();
    }

    public void rejected(RejectionReason reason) {
        registry.counter(REJECTED, "reason", reason.name()).increment();
    }

    public void unhandled(MachineChannel channel) {
        registry.counter(UNHANDLED, "channel", channel.topicLevel()).increment();
    }

    public void handlerError(MachineChannel channel) {
        registry.counter(HANDLER_ERRORS, "channel", channel.topicLevel()).increment();
    }

    /** Sum over all tags, for diagnostics and tests. */
    public double count(String name) {
        return registry.find(name).counters().stream().mapToDouble(Counter::count).sum();
    }

    public double count(String name, String tag, String value) {
        return registry.find(name).tag(tag, value).counters().stream().mapToDouble(Counter::count).sum();
    }
}
