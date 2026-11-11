package com.fruitmachine.backend.mqtt.inbound;

import com.fruitmachine.backend.mqtt.MqttMetrics;
import com.fruitmachine.backend.mqtt.message.MachineChannel;
import com.fruitmachine.backend.mqtt.message.MachineMessage;
import com.fruitmachine.backend.mqtt.message.MachineMessageHandler;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** Routes a validated message to the single handler of its channel. Never throws: a failing handler cannot stop the MQTT client. */
@Component
public class MachineMessageDispatcher {
    private static final Logger log = LoggerFactory.getLogger(MachineMessageDispatcher.class);

    private final Map<MachineChannel, MachineMessageHandler> handlers = new EnumMap<>(MachineChannel.class);
    private final MqttMetrics metrics;

    public MachineMessageDispatcher(List<MachineMessageHandler> handlers, MqttMetrics metrics) {
        for (MachineMessageHandler handler : handlers) {
            MachineMessageHandler previous = this.handlers.putIfAbsent(handler.channel(), handler);
            if (previous != null) throw new IllegalStateException("More than one MachineMessageHandler for channel " + handler.channel());
        }
        this.metrics = metrics;
    }

    /** @return true when a handler processed the message without throwing. */
    public boolean dispatch(MachineMessage message) {
        MachineMessageHandler handler = handlers.get(message.channel());
        if (handler == null) {
            metrics.unhandled(message.channel());
            log.debug("No MQTT handler for channel {}; dropped message {} of machine {}", message.channel(), message.messageId(), message.machineCode());
            return false;
        }
        try {
            handler.handle(message);
            return true;
        } catch (RuntimeException e) {
            metrics.handlerError(message.channel());
            // Exception type only: messages of handler exceptions may quote payload values.
            log.error("MQTT {} handler failed for machine {} message {}: {}", message.channel(), message.machineCode(), message.messageId(),
                    e.getClass().getName());
            log.debug("MQTT handler failure detail", e);
            return false;
        }
    }
}
