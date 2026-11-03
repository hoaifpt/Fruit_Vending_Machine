#include "MqttService.h"

#include <WiFi.h>
#include <cstring>

#include "app_config.h"

MqttService *MqttService::activeInstance = nullptr;

MqttService::MqttService(DispenseController &dispenseController)
    : dispenseController(dispenseController), mqttClient(networkClient) {}

bool MqttService::begin()
{
    if (AppConfig::MQTT_HOST[0] == '\0')
    {
        Serial.println("MQTT broker is not configured; add include/secrets.h");
        return false;
    }

    snprintf(
        commandTopic,
        sizeof(commandTopic),
        "fruit-vending/%s/command",
        AppConfig::MACHINE_ID);
    snprintf(
        statusTopic,
        sizeof(statusTopic),
        "fruit-vending/%s/status",
        AppConfig::MACHINE_ID);
    snprintf(
        heartbeatTopic,
        sizeof(heartbeatTopic),
        "fruit-vending/%s/heartbeat",
        AppConfig::MACHINE_ID);

    activeInstance = this;
    mqttClient.setServer(AppConfig::MQTT_HOST, AppConfig::MQTT_PORT);
    mqttClient.setCallback(MqttService::onMessage);
    mqttClient.setBufferSize(256);
    return true;
}

void MqttService::loop()
{
    if (WiFi.status() != WL_CONNECTED || AppConfig::MQTT_HOST[0] == '\0')
    {
        return;
    }

    if (!mqttClient.connected())
    {
        const unsigned long now = millis();
        if (now - lastAttemptAt >= AppConfig::MQTT_RETRY_INTERVAL_MS)
        {
            lastAttemptAt = now;
            connect();
        }
        return;
    }

    mqttClient.loop();

    const unsigned long now = millis();
    if (now - lastHeartbeatAt >= AppConfig::MQTT_HEARTBEAT_INTERVAL_MS)
    {
        lastHeartbeatAt = now;
        publishHeartbeat();
    }
}

bool MqttService::connect()
{
    Serial.print("Connecting to MQTT broker...");

    bool connected = false;
    if (AppConfig::MQTT_USERNAME[0] != '\0')
    {
        connected = mqttClient.connect(
            AppConfig::MACHINE_ID,
            AppConfig::MQTT_USERNAME,
            AppConfig::MQTT_PASSWORD,
            statusTopic,
            0,
            true,
            "offline");
    }
    else
    {
        connected = mqttClient.connect(
            AppConfig::MACHINE_ID,
            statusTopic,
            0,
            true,
            "offline");
    }

    if (!connected)
    {
        Serial.print(" failed, state=");
        Serial.println(mqttClient.state());
        return false;
    }

    Serial.println(" connected");
    mqttClient.subscribe(commandTopic);
    lastHeartbeatAt = millis();
    publishStatus("online");
    publishHeartbeat();
    Serial.print("Subscribed to: ");
    Serial.println(commandTopic);
    return true;
}

void MqttService::publishStatus(const char *message)
{
    if (mqttClient.connected())
    {
        mqttClient.publish(statusTopic, message, true);
    }
}

void MqttService::publishHeartbeat()
{
    if (!mqttClient.connected())
    {
        return;
    }

    char payload[256];
    snprintf(
        payload,
        sizeof(payload),
        "{\"machineId\":\"%s\",\"status\":\"ONLINE\","
        "\"uptimeSeconds\":%lu,\"wifiRssi\":%d,\"freeHeap\":%lu,"
        "\"temperatureC\":null,\"temperatureStatus\":\"SENSOR_ERROR\"}",
        AppConfig::MACHINE_ID,
        millis() / 1000UL,
        WiFi.RSSI(),
        static_cast<unsigned long>(ESP.getFreeHeap()));

    if (!mqttClient.publish(heartbeatTopic, payload))
    {
        Serial.println("Failed to publish MQTT heartbeat");
    }
}

void MqttService::onMessage(
    char *topic,
    uint8_t *payload,
    unsigned int length)
{
    if (activeInstance != nullptr)
    {
        activeInstance->handleMessage(topic, payload, length);
    }
}

void MqttService::handleMessage(
    char *topic,
    uint8_t *payload,
    unsigned int length)
{
    if (strcmp(topic, commandTopic) != 0)
    {
        return;
    }

    DispenseCommand command;
    const char *commandName;
    if (length == 4 && memcmp(payload, "NEXT", 4) == 0)
    {
        command = DispenseCommand::NEXT;
        commandName = "NEXT";
    }
    else if (length == 4 && memcmp(payload, "STOP", 4) == 0)
    {
        command = DispenseCommand::STOP;
        commandName = "STOP";
    }
    else
    {
        publishStatus("rejected:UNKNOWN_COMMAND");
        return;
    }

    if (dispenseController.handleCommand(command))
    {
        char response[32];
        snprintf(response, sizeof(response), "accepted:%s", commandName);
        publishStatus(response);
    }
    else
    {
        publishStatus("rejected:BUSY");
    }
}
