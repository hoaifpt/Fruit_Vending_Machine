#pragma once

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFiClient.h>

// Machine <-> backend MQTT (docs/mqtt-dispense.md, envelope schemaVersion 1).
// Publishes status, events and telemetry; subscribes to <root>/<machineCode>/commands for DISPENSE commands from the backend.
class MqttService
{
public:
    // Called from loop() with a validated commandId of a DISPENSE command addressed to this machine.
    using DispenseHandler = void (*)(const char *commandId, uint8_t column);

    MqttService();

    bool begin();
    void loop();
    bool connected();
    void onDispense(DispenseHandler handler) { dispenseHandler = handler; }

    // payloadJson must be a JSON object built from trusted values (numbers, validated ids).
    bool publishTelemetry(float temperatureC, float humidityPercent);
    bool publishEvent(const char *eventType, const char *detailsJson);

private:
    bool connect();
    bool publish(const char *channel, const char *payloadJson);
    void buildEnvelope(char *out, size_t size, const char *messageId, const char *payloadJson);
    void topicFor(char *out, size_t size, const char *channel);
    void handleMessage(char *topic, uint8_t *payload, unsigned int length);

    WiFiClient networkClient;
    PubSubClient mqttClient;
    char statusTopic[96] = {};
    char commandTopic[96] = {};
    char willMessage[256] = {};
    char bootId[9] = {};
    unsigned long sequence = 0;
    unsigned long lastAttemptAt = 0;
    bool configured = false;
    DispenseHandler dispenseHandler = nullptr;
};
