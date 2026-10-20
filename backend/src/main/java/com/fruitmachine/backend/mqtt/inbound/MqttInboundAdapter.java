package com.fruitmachine.backend.mqtt.inbound;

import com.fruitmachine.backend.mqtt.MqttMetrics;
import com.fruitmachine.backend.mqtt.message.MachineMessage;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Integration boundary called on the MQTT callback thread: parse, resolve the machine, dispatch. No business logic and no
 * transaction here. It never throws, because an exception escaping a Paho callback would disconnect the client; a dropped
 * QoS 1 message is therefore acknowledged and not redelivered.
 */
@Component
@RequiredArgsConstructor
public class MqttInboundAdapter {
    private static final Logger log = LoggerFactory.getLogger(MqttInboundAdapter.class);

    private final MachineMessageParser parser;
    private final MachineResolver resolver;
    private final MachineMessageDispatcher dispatcher;
    private final RejectionLogLimiter rejections;
    private final MqttMetrics metrics;

    public void onMessage(String topic, byte[] body) {
        metrics.received();
        try {
            var parsed = parser.parse(topic, body);
            UUID machineId = resolver.resolve(parsed.machineCode(), parsed.messageId());
            metrics.accepted(parsed.channel());
            dispatcher.dispatch(new MachineMessage(machineId, parsed.machineCode(), parsed.channel(), parsed.messageId(),
                    parsed.sentAt(), parsed.receivedAt(), parsed.payload()));
        } catch (MachineMessageRejectedException rejection) {
            metrics.rejected(rejection.reason());
            rejections.warn(topic, rejection);
        } catch (RuntimeException e) {
            // For example the database is unavailable while resolving the machine.
            log.error("MQTT message on {} could not be processed: {}", RejectionLogLimiter.sanitize(topic), e.getClass().getName());
            log.debug("MQTT processing failure detail", e);
        }
    }
}
