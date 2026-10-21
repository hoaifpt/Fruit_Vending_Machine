#pragma once

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFiClient.h>

// Machine -> backend MQTT (backend repo: api-contract/mqtt-contract.md, schemaVersion 1). Publish only: telemetry, status, events.
// There is no command subscription; dispensing never goes over MQTT (it comes from the kiosk over Serial).
class MqttService
{
public:
    MqttService();

    bool begin();
    void loop();
    bool connected();

    // payloadJson must be a JSON object built from trusted values (numbers, validated ids).
    bool publishTelemetry(float temperatureC, float humidityPercent);
    bool publishEvent(const char *eventType, const char *detailsJson);

private:
    bool connect();
    bool publish(const char *channel, const char *payloadJson);
    void buildEnvelope(char *out, size_t size, const char *messageId, const char *payloadJson);
    void topicFor(char *out, size_t size, const char *channel);

    WiFiClient networkClient;
    PubSubClient mqttClient;
    char statusTopic[96] = {};
    char willMessage[256] = {};
    char bootId[9] = {};
    unsigned long sequence = 0;
    unsigned long lastAttemptAt = 0;
    bool configured = false;
};
