#pragma once

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFiClient.h>

#include "application/DispenseController.h"

class MqttService
{
public:
    explicit MqttService(DispenseController &dispenseController);

    bool begin();
    void loop();

private:
    static MqttService *activeInstance;
    static void onMessage(char *topic, uint8_t *payload, unsigned int length);

    void handleMessage(char *topic, uint8_t *payload, unsigned int length);
    bool connect();
    void publishStatus(const char *message);

    DispenseController &dispenseController;
    WiFiClient networkClient;
    PubSubClient mqttClient;
    char commandTopic[96] = {};
    char statusTopic[96] = {};
    unsigned long lastAttemptAt = 0;
};
