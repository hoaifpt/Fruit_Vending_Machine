#include <Arduino.h>
#include <cstring>

#include "app_config.h"
#include "pin_config.h"
#include "application/DispenseController.h"
#include "hal/SensorDriver.h"
#include "hal/ServoDriver.h"
#include "services/MqttService.h"
#include "services/SerialCommandService.h"
#include "services/WifiService.h"
#include "utils/Logger.h"

// Dispense: backend -> MQTT <root>/<code>/commands -> DispenseController -> servos -> events back to the backend
// (docs/mqtt-dispense.md). USB Serial keeps the same idempotent DISPENSE for tests and calibration; runs Serial-only without Wi-Fi/MQTT.
ServoDriver servoDriver;
SensorDriver sensorDriver;
DispenseController dispenser(servoDriver);
SerialCommandService serialCommands(dispenser);
WifiService wifiService;
MqttService mqttService;

// Backend command over MQTT: answer with an event so the backend knows the command arrived (or why it did not start).
void onMqttDispense(const char *commandId, char columnCode)
{
    char details[128];
    snprintf(details, sizeof(details), "{\"commandId\":\"%s\",\"columnCode\":\"%c\"}", commandId, columnCode);
    switch (serialCommands.requestDispense(commandId, columnCode))
    {
    case SerialCommandService::DispenseReply::STARTED:
    case SerialCommandService::DispenseReply::IN_PROGRESS:
        mqttService.publishEvent("DISPENSE_ACCEPTED", details);
        break;
    case SerialCommandService::DispenseReply::DONE_OK:
        // A re-sent command that already finished: repeat the result, nothing moves.
        mqttService.publishEvent("DISPENSE_COMPLETED", details);
        break;
    case SerialCommandService::DispenseReply::DONE_ABORTED:
        mqttService.publishEvent("DISPENSE_ABORTED", details);
        break;
    case SerialCommandService::DispenseReply::BUSY:
        snprintf(details, sizeof(details), "{\"commandId\":\"%s\",\"columnCode\":\"%c\",\"state\":\"%s\"}",
                 commandId, columnCode, dispenser.stateName());
        mqttService.publishEvent("DISPENSE_REJECTED", details);
        break;
    case SerialCommandService::DispenseReply::INVALID:
        Logger::info("MQTT dispense ignored: invalid commandId");
        break;
    }
}

void onMqttMaintenance(const char *commandId, char columnCode, const char *operation)
{
    char details[160];
    const char *prefix = nullptr;
    if (strcmp(operation, "OPEN_REFILL") == 0)
    {
        prefix = "MAINTENANCE_OPEN_REFILL_";
    }
    else if (strcmp(operation, "CLOSE_REFILL") == 0)
    {
        prefix = "MAINTENANCE_CLOSE_REFILL_";
    }
    else if (strcmp(operation, "EMPTY_COLUMN") == 0)
    {
        prefix = "MAINTENANCE_EMPTY_COLUMN_";
    }
    else if (strcmp(operation, "REMOVE_ITEM") == 0)
    {
        prefix = "MAINTENANCE_REMOVE_ITEM_";
    }
    else
    {
        Logger::info("MQTT maintenance ignored: invalid operation");
        return;
    }
    snprintf(details, sizeof(details),
             "{\"commandId\":\"%s\",\"columnCode\":\"%c\",\"operation\":\"%s\"}",
             commandId, columnCode, operation);

    if (dispenser.maintenanceClearActive() &&
        strcmp(dispenser.activeCommandId(), commandId) == 0 &&
        dispenser.maintenanceColumnCode() == columnCode &&
        dispenser.maintenanceOperationActive(operation))
    {
        char eventType[48];
        snprintf(eventType, sizeof(eventType), "%sACCEPTED", prefix);
        mqttService.publishEvent(eventType, details);
        return;
    }

    if (dispenser.maintenanceAlreadyCompleted(commandId, columnCode, operation))
    {
        char eventType[48];
        snprintf(eventType, sizeof(eventType), "%s%s", prefix,
                 dispenser.lastMaintenanceOutcomeValue() == DispenseOutcome::OK
                     ? "COMPLETED"
                     : "ABORTED");
        mqttService.publishEvent(eventType, details);
        return;
    }

    bool started = false;
    if (strcmp(operation, "OPEN_REFILL") == 0)
    {
        started = dispenser.startMaintenanceOpenRefill(commandId, columnCode);
    }
    else if (strcmp(operation, "CLOSE_REFILL") == 0)
    {
        started = dispenser.startMaintenanceCloseRefill(commandId, columnCode);
    }
    else if (strcmp(operation, "EMPTY_COLUMN") == 0)
    {
        started = dispenser.startMaintenanceEmptyColumn(commandId, columnCode);
    }
    else
    {
        started = dispenser.startMaintenanceRemoveItem(commandId, columnCode);
    }
    if (started)
    {
        char eventType[48];
        snprintf(eventType, sizeof(eventType), "%sACCEPTED", prefix);
        mqttService.publishEvent(eventType, details);
        return;
    }

    snprintf(details, sizeof(details), "{\"commandId\":\"%s\",\"state\":\"%s\"}",
             commandId, dispenser.stateName());
    char eventType[48];
    snprintf(eventType, sizeof(eventType), "%sREJECTED", prefix);
    mqttService.publishEvent(eventType, details);
}

void setup()
{
    Serial.begin(AppConfig::SERIAL_BAUD);
    delay(200);

    if (!servoDriver.begin(PinConfig::SERVO_1, PinConfig::SERVO_2, PinConfig::SERVO_3, PinConfig::SERVO_4))
    {
        Logger::info("Servo initialization failed; check pins in include/pin_config.h");
    }
    sensorDriver.begin(PinConfig::SENSOR);
    dispenser.begin();
    wifiService.begin();
    mqttService.onDispense(onMqttDispense);
    mqttService.onMaintenance(onMqttMaintenance);
    mqttService.begin();
    serialCommands.begin();
}

void loop()
{
    serialCommands.loop();
    dispenser.update();

    DispenseController::Result result;
    if (dispenser.takeResult(result))
    {
        if (result.maintenanceClear)
        {
            char maintenanceDetails[160];
            snprintf(maintenanceDetails, sizeof(maintenanceDetails),
                     "{\"commandId\":\"%s\",\"columnCode\":\"%c\",\"operation\":\"%s\"}",
                     result.commandId, result.columnCode,
                     result.maintenanceOperation);
            const char *prefix = nullptr;
            if (strcmp(result.maintenanceOperation, "OPEN_REFILL") == 0)
            {
                prefix = "MAINTENANCE_OPEN_REFILL_";
            }
            else if (strcmp(result.maintenanceOperation, "CLOSE_REFILL") == 0)
            {
                prefix = "MAINTENANCE_CLOSE_REFILL_";
            }
            else if (strcmp(result.maintenanceOperation, "EMPTY_COLUMN") == 0)
            {
                prefix = "MAINTENANCE_EMPTY_COLUMN_";
            }
            else
            {
                prefix = "MAINTENANCE_REMOVE_ITEM_";
            }
            char eventType[48];
            snprintf(eventType, sizeof(eventType), "%s%s", prefix,
                     result.outcome == DispenseOutcome::OK ? "COMPLETED" : "ABORTED");
            mqttService.publishEvent(eventType, maintenanceDetails);
        }
        else
        {
            char details[128];
            snprintf(details, sizeof(details), "{\"commandId\":\"%s\",\"columnCode\":\"%c\"}",
                     result.commandId, result.columnCode);
            serialCommands.reportResult(result);
            mqttService.publishEvent(
                result.outcome == DispenseOutcome::OK ? "DISPENSE_COMPLETED" : "DISPENSE_ABORTED",
                details);
        }
    }

    // The sensor only reports; it never moves a servo (only a DISPENSE command can).
    if (sensorDriver.update())
    {
        Logger::info("Bowl sensor triggered (state %s)", dispenser.stateName());
        char details[64];
        snprintf(details, sizeof(details), "{\"dispenseState\":\"%s\"}", dispenser.stateName());
        mqttService.publishEvent("BOWL_SENSOR_TRIGGERED", details);
    }

    wifiService.loop();
    mqttService.loop();
}
