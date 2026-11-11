package com.fruitmachine.backend.mqtt.message;

/**
 * Extension point for one MQTT channel; at most one handler bean per channel. Runs on the MQTT callback thread: keep it short,
 * delegate to an application service that owns the transaction, and tolerate duplicate messageIds. A thrown exception is logged
 * and the message is dropped; later messages keep flowing.
 */
public interface MachineMessageHandler {
    MachineChannel channel();

    void handle(MachineMessage message);
}
