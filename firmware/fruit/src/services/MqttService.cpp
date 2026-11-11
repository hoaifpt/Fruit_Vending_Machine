#include "MqttService.h"

#include <ArduinoJson.h>
#include <WiFi.h>

#include "app_config.h"
#include "error_codes.h"
#include "services/ConfigPortalService.h"
#include "utils/Logger.h"

MqttService::MqttService()
    : mqttClient(networkClient) {}

bool MqttService::begin(ConfigPortalService &config)
{
    configPortal = &config;
    if (config.mqttHost()[0] == '\0')
    {
        Logger::warn("MQTT broker is not configured; running Serial-only");
        return false;
    }

    // A new id per boot keeps messageIds unique per machine without a real-time clock.
    snprintf(bootId, sizeof(bootId), "%08lx", static_cast<unsigned long>(esp_random()));
    topicFor(statusTopic, sizeof(statusTopic), "status");
    topicFor(commandTopic, sizeof(commandTopic), "commands");
    char willId[24];
    snprintf(willId, sizeof(willId), "lwt-%s", bootId);
    buildEnvelope(willMessage, sizeof(willMessage), willId, "{\"state\":\"OFFLINE\"}");

    mqttClient.setServer(config.mqttHost(), config.mqttPort());
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

    const unsigned long now = millis();
    if (now - lastHeartbeatAt >= AppConfig::MQTT_HEARTBEAT_INTERVAL_MS)
    {
        publishHeartbeat();
        lastHeartbeatAt = now;
    }
}

bool MqttService::connected()
{
    return configured && mqttClient.connected();
}

bool MqttService::connect()
{
    // Username = client id = machine code; the broker ACL lets this account publish only vending/<code>/....
    const bool ok = mqttClient.connect(
        configPortal->machineCode(),
        configPortal->machineCode(),
        configPortal->mqttPassword(),
        statusTopic,
        1,
        false,
        willMessage);

    if (!ok)
    {
        // state 5 = not authorised (password/ACL), -2 = broker unreachable.
        setLastError(ErrorCode::ERR_MQTT_DISCONNECTED);
        Logger::error(ErrorCode::ERR_MQTT_DISCONNECTED, "MQTT connect to %s:%u failed, state=%d",
                      configPortal->mqttHost(), configPortal->mqttPort(), mqttClient.state());
        return false;
    }

    char payload[128];
    snprintf(payload, sizeof(payload), "{\"state\":\"ONLINE\",\"firmwareVersion\":\"%s\",\"uptimeSeconds\":%lu}",
             AppConfig::FIRMWARE_VERSION, millis() / 1000UL);
    publish("status", payload);
    lastHeartbeatAt = millis();
    publishHeartbeat();

    // Clean session: subscribe again after every (re)connect.
    if (!mqttClient.subscribe(commandTopic, 1))
    {
        Logger::warn("MQTT subscribe to %s failed", commandTopic);
    }
    Logger::info("MQTT connected as %s, listening on %s", configPortal->machineCode(), commandTopic);
    return true;
}

void MqttService::setLastError(const char *code)
{
    if (code == nullptr || code[0] == '\0')
    {
        lastError[0] = '\0';
        return;
    }
    strncpy(lastError, code, sizeof(lastError) - 1);
    lastError[sizeof(lastError) - 1] = '\0';
}

bool MqttService::publishHeartbeat()
{
    char payload[256];
    if (lastError[0] != '\0')
    {
        snprintf(payload, sizeof(payload),
                 "{\"state\":\"ONLINE\",\"uptimeSeconds\":%lu,\"wifiRssi\":%d,\"freeHeap\":%lu,\"firmwareVersion\":\"%s\",\"lastError\":\"%s\"}",
                 millis() / 1000UL,
                 WiFi.RSSI(),
                 static_cast<unsigned long>(ESP.getFreeHeap()),
                 AppConfig::FIRMWARE_VERSION,
                 lastError);
    }
    else
    {
        snprintf(payload, sizeof(payload),
                 "{\"state\":\"ONLINE\",\"uptimeSeconds\":%lu,\"wifiRssi\":%d,\"freeHeap\":%lu,\"firmwareVersion\":\"%s\",\"lastError\":null}",
                 millis() / 1000UL,
                 WiFi.RSSI(),
                 static_cast<unsigned long>(ESP.getFreeHeap()),
                 AppConfig::FIRMWARE_VERSION);
    }
    return publish("heartbeat", payload);
}

bool MqttService::publishError(const char *errorCode, const char *message, const char *commandId, char columnCode)
{
    setLastError(errorCode);
    char details[256];
    if (commandId != nullptr && commandId[0] != '\0')
    {
        if (columnCode != '\0')
        {
            snprintf(details, sizeof(details),
                     "{\"errorCode\":\"%s\",\"message\":\"%s\",\"commandId\":\"%s\",\"columnCode\":\"%c\"}",
                     errorCode ? errorCode : "ERR_UNKNOWN",
                     message ? message : "",
                     commandId, columnCode);
        }
        else
        {
            snprintf(details, sizeof(details),
                     "{\"errorCode\":\"%s\",\"message\":\"%s\",\"commandId\":\"%s\"}",
                     errorCode ? errorCode : "ERR_UNKNOWN",
                     message ? message : "",
                     commandId);
        }
    }
    else
    {
        snprintf(details, sizeof(details),
                 "{\"errorCode\":\"%s\",\"message\":\"%s\"}",
                 errorCode ? errorCode : "ERR_UNKNOWN",
                 message ? message : "");
    }
    Logger::error(errorCode, "%s", message ? message : "");
    return publishEvent("ERROR", details);
}

void MqttService::handleMessage(char *topic, uint8_t *payload, unsigned int length)
{
    if (strcmp(topic, commandTopic) != 0)
    {
        return;
    }
    JsonDocument doc;
    if (deserializeJson(doc, payload, length))
    {
        Logger::error(ErrorCode::ERR_MALFORMED_JSON, "MQTT command ignored: invalid JSON");
        publishError(ErrorCode::ERR_MALFORMED_JSON, "Invalid JSON payload in MQTT command");
        return;
    }
    const char *machine = doc["machineCode"] | "";
    const char *type = doc["payload"]["type"] | "";
    const char *id = doc["payload"]["commandId"] | "";
    const char *column = doc["payload"]["columnCode"] | "";
    if (strcmp(machine, configPortal->machineCode()) != 0)
    {
        Logger::warn("MQTT command ignored: type %s for machine %s (expected %s)",
                     type, machine, configPortal->machineCode());
        return;
    }
    // Copy first: publishing an answer reuses PubSubClient's buffer, which `payload` points into.
    char commandId[48];
    strncpy(commandId, id, sizeof(commandId) - 1);
    commandId[sizeof(commandId) - 1] = '\0';
    if (strcmp(type, "DISPENSE") == 0 && dispenseHandler != nullptr)
    {
        char col = column[0];
        if (col == '\0')
        {
            col = 'A';
        }
        else if (column[1] != '\0' || (col != 'A' && col != 'B'))
        {
            Logger::error(ErrorCode::ERR_INVALID_COLUMN, "MQTT dispense ignored: invalid columnCode '%s'", column);
            char details[128];
            snprintf(details, sizeof(details),
                     "{\"commandId\":\"%s\",\"columnCode\":\"%s\",\"errorCode\":\"%s\"}",
                     commandId, column, ErrorCode::ERR_INVALID_COLUMN);
            setLastError(ErrorCode::ERR_INVALID_COLUMN);
            publishEvent("DISPENSE_REJECTED", details);
            return;
        }
        dispenseHandler(commandId, col);
    }
    else if ((strcmp(type, "MAINTENANCE_REMOVE_ITEM") == 0 ||
              strcmp(type, "MAINTENANCE_EMPTY_COLUMN") == 0 ||
              strcmp(type, "MAINTENANCE_OPEN_REFILL") == 0 ||
              strcmp(type, "MAINTENANCE_CLOSE_REFILL") == 0) &&
             maintenanceHandler != nullptr)
    {
        if (column[0] == '\0' || column[1] != '\0' || (column[0] != 'A' && column[0] != 'B'))
        {
            Logger::error(ErrorCode::ERR_INVALID_COLUMN, "MQTT maintenance command ignored: invalid columnCode '%s'", column);
            char details[128];
            snprintf(details, sizeof(details),
                     "{\"commandId\":\"%s\",\"columnCode\":\"%s\",\"errorCode\":\"%s\"}",
                     commandId, column, ErrorCode::ERR_INVALID_COLUMN);
            setLastError(ErrorCode::ERR_INVALID_COLUMN);
            publishEvent("MAINTENANCE_REJECTED", details);
            return;
        }
        const char *operation = strcmp(type, "MAINTENANCE_OPEN_REFILL") == 0
                                    ? "OPEN_REFILL"
                                    : strcmp(type, "MAINTENANCE_CLOSE_REFILL") == 0
                                          ? "CLOSE_REFILL"
                                          : strcmp(type, "MAINTENANCE_EMPTY_COLUMN") == 0
                                                ? "EMPTY_COLUMN"
                                                : "REMOVE_ITEM";
        maintenanceHandler(commandId, column[0], operation);
    }
    else
    {
        Logger::error(ErrorCode::ERR_UNKNOWN_COMMAND, "Unknown or unhandled command type: %s", type);
        publishError(ErrorCode::ERR_UNKNOWN_COMMAND, "Unknown command type received", commandId);
    }
}

bool MqttService::publishTelemetry(float temperatureC, float humidityPercent)
{
    char payload[96];
    snprintf(payload, sizeof(payload), "{\"temperature\":%.1f,\"humidity\":%.1f}", temperatureC, humidityPercent);
    return publish("telemetry", payload);
}

bool MqttService::publishTemperatureTelemetry(float temperatureC)
{
    char payload[96];
    snprintf(payload, sizeof(payload), "{\"temperature\":%.2f,\"humidity\":null}", temperatureC);
    return publish("telemetry", payload);
}

bool MqttService::publishEvent(const char *eventType, const char *detailsJson)
{
    char payload[384];
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
             messageId, configPortal->machineCode(), payloadJson);
}

void MqttService::topicFor(char *out, size_t size, const char *channel)
{
    snprintf(out, size, "%s/%s/%s", AppConfig::MQTT_TOPIC_ROOT, configPortal->machineCode(), channel);
}
