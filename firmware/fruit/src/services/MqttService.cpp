#include "MqttService.h"

#include <ArduinoJson.h>
#include <WiFi.h>

#include "app_config.h"
#include "utils/Logger.h"

MqttService::MqttService()
    : mqttClient(networkClient) {}

bool MqttService::begin()
{
    if (AppConfig::MQTT_HOST[0] == '\0' || AppConfig::MQTT_PASSWORD[0] == '\0')
    {
        Logger::info("MQTT not configured (APP_MQTT_HOST / APP_MQTT_PASSWORD in include/secrets.h); running Serial-only");
        return false;
    }

    // A new id per boot keeps messageIds unique per machine without a real-time clock.
    snprintf(bootId, sizeof(bootId), "%08lx", static_cast<unsigned long>(esp_random()));
    topicFor(statusTopic, sizeof(statusTopic), "status");
    topicFor(commandTopic, sizeof(commandTopic), "commands");
    char willId[24];
    snprintf(willId, sizeof(willId), "lwt-%s", bootId);
    buildEnvelope(willMessage, sizeof(willMessage), willId, "{\"state\":\"OFFLINE\"}");

    mqttClient.setServer(AppConfig::MQTT_HOST, AppConfig::MQTT_PORT);
    mqttClient.setBufferSize(AppConfig::MQTT_BUFFER_SIZE);
    mqttClient.setKeepAlive(AppConfig::MQTT_KEEP_ALIVE_SECONDS);
    mqttClient.setCallback([this](char *topic, uint8_t *payload, unsigned int length) { handleMessage(topic, payload, length); });
    configured = true;
    return true;
}

void MqttService::loop()
{
    if (!configured || WiFi.status() != WL_CONNECTED)
    {
        return;
    }

    if (!mqttClient.connected())
    {
        const unsigned long now = millis();
        if (lastAttemptAt == 0 || now - lastAttemptAt >= AppConfig::MQTT_RETRY_INTERVAL_MS)
        {
            lastAttemptAt = now;
            connect();
        }
        return;
    }

    mqttClient.loop();
}

bool MqttService::connected()
{
    return configured && mqttClient.connected();
}

bool MqttService::connect()
{
    // Username = client id = machine code; the broker ACL lets this account publish only vending/<code>/....
    const bool ok = mqttClient.connect(
        AppConfig::MACHINE_CODE,
        AppConfig::MACHINE_CODE,
        AppConfig::MQTT_PASSWORD,
        statusTopic,
        1,
        false,
        willMessage);

    if (!ok)
    {
        // state 5 = not authorised (password/ACL), -2 = broker unreachable.
        Logger::info("MQTT connect to %s:%u failed, state=%d", AppConfig::MQTT_HOST, AppConfig::MQTT_PORT, mqttClient.state());
        return false;
    }

    char payload[128];
    snprintf(payload, sizeof(payload), "{\"state\":\"ONLINE\",\"firmwareVersion\":\"%s\",\"uptimeSeconds\":%lu}",
             AppConfig::FIRMWARE_VERSION, millis() / 1000UL);
    publish("status", payload);
    // Clean session: subscribe again after every (re)connect.
    if (!mqttClient.subscribe(commandTopic, 1))
    {
        Logger::info("MQTT subscribe to %s failed", commandTopic);
    }
    Logger::info("MQTT connected as %s, listening on %s", AppConfig::MACHINE_CODE, commandTopic);
    return true;
}

void MqttService::handleMessage(char *topic, uint8_t *payload, unsigned int length)
{
    if (strcmp(topic, commandTopic) != 0 || dispenseHandler == nullptr)
    {
        return;
    }
    JsonDocument doc;
    if (deserializeJson(doc, payload, length))
    {
        Logger::info("MQTT command ignored: invalid JSON");
        return;
    }
    const char *machine = doc["machineCode"] | AppConfig::MACHINE_CODE;
    const char *type = doc["payload"]["type"] | "";
    const char *id = doc["payload"]["commandId"] | "";
    if (strcmp(machine, AppConfig::MACHINE_CODE) != 0 || strcmp(type, "DISPENSE") != 0)
    {
        Logger::info("MQTT command ignored: type %s for machine %s", type, machine);
        return;
    }
    // Copy first: publishing an answer reuses PubSubClient's buffer, which `payload` points into.
    char commandId[48];
    strncpy(commandId, id, sizeof(commandId) - 1);
    commandId[sizeof(commandId) - 1] = '\0';

    uint8_t column = 1;
    if (doc["payload"]["column"].is<int>())
    {
        column = doc["payload"]["column"].as<uint8_t>();
    }
    else if (doc["payload"]["slot"].is<const char *>())
    {
        const char *s = doc["payload"]["slot"];
        if (s != nullptr && (s[0] == 'B' || s[0] == 'b' || s[0] == '2'))
        {
            column = 2;
        }
    }

    dispenseHandler(commandId, column);
}

bool MqttService::publishTelemetry(float temperatureC, float humidityPercent)
{
    char payload[96];
    snprintf(payload, sizeof(payload), "{\"temperature\":%.1f,\"humidity\":%.1f}", temperatureC, humidityPercent);
    return publish("telemetry", payload);
}

bool MqttService::publishEvent(const char *eventType, const char *detailsJson)
{
    char payload[192];
    snprintf(payload, sizeof(payload), "{\"eventType\":\"%s\",\"details\":%s}", eventType, detailsJson);
    return publish("events", payload);
}

bool MqttService::publish(const char *channel, const char *payloadJson)
{
    if (!connected())
    {
        return false;
    }
    char messageId[32];
    snprintf(messageId, sizeof(messageId), "%s-%lu", bootId, ++sequence);
    char topic[96];
    topicFor(topic, sizeof(topic), channel);
    char envelope[AppConfig::MQTT_BUFFER_SIZE - 128];
    buildEnvelope(envelope, sizeof(envelope), messageId, payloadJson);
    // PubSubClient publishes at QoS 0; the backend accepts it (the contract recommends QoS 1 when the library allows it).
    return mqttClient.publish(topic, envelope, false);
}

void MqttService::buildEnvelope(char *out, size_t size, const char *messageId, const char *payloadJson)
{
    // sentAt is omitted: the ESP32 has no reliable clock; the backend records receivedAt itself.
    snprintf(out, size, "{\"schemaVersion\":1,\"messageId\":\"%s\",\"machineCode\":\"%s\",\"payload\":%s}",
             messageId, AppConfig::MACHINE_CODE, payloadJson);
}

void MqttService::topicFor(char *out, size_t size, const char *channel)
{
    snprintf(out, size, "%s/%s/%s", AppConfig::MQTT_TOPIC_ROOT, AppConfig::MACHINE_CODE, channel);
}
