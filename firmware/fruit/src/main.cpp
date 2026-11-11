#include <Arduino.h>
#include <cstring>

#include "app_config.h"
#include "pin_config.h"
#include "error_codes.h"
#include "application/DispenseController.h"
#include "hal/SensorDriver.h"
#include "hal/TemperatureSensorDriver.h"
#include "hal/ServoDriver.h"
#include "services/MqttService.h"
#include "services/ConfigPortalService.h"
#include "services/SerialCommandService.h"
#include "services/WifiService.h"
#include "utils/Logger.h"

// Dispense: backend -> MQTT <root>/<code>/commands -> DispenseController -> servos -> events back to the backend
// (docs/mqtt-dispense.md). USB Serial keeps the same idempotent DISPENSE for tests and calibration; runs Serial-only without Wi-Fi/MQTT.
ServoDriver servoDriver;
SensorDriver sensorDriver;
TemperatureSensorDriver temperatureSensor;
DispenseController dispenser(servoDriver);
SerialCommandService serialCommands(dispenser);
WifiService wifiService;
MqttService mqttService;
ConfigPortalService configPortal;

static bool bootErrorPublished = false;

// Backend command over MQTT: answer with an event so the backend knows the command arrived (or why it did not start).
void onMqttDispense(const char *commandId, char columnCode)
{
    char details[160];
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
        snprintf(details, sizeof(details),
                 "{\"commandId\":\"%s\",\"columnCode\":\"%c\",\"errorCode\":\"%s\"}",
                 commandId, columnCode, ErrorCode::ERR_DISPENSE_ABORTED);
        mqttService.setLastError(ErrorCode::ERR_DISPENSE_ABORTED);
        mqttService.publishEvent("DISPENSE_ABORTED", details);
        break;
    case SerialCommandService::DispenseReply::BUSY:
    {
        const char *err = (dispenser.state() == DispenseState::FAULT)
                              ? ErrorCode::ERR_SYSTEM_FAULT
                              : ErrorCode::ERR_MACHINE_BUSY;
        snprintf(details, sizeof(details),
                 "{\"commandId\":\"%s\",\"columnCode\":\"%c\",\"state\":\"%s\",\"errorCode\":\"%s\"}",
                 commandId, columnCode, dispenser.stateName(), err);
        mqttService.setLastError(err);
        mqttService.publishEvent("DISPENSE_REJECTED", details);
        Logger::warn("MQTT dispense rejected for %s: state %s (%s)", commandId, dispenser.stateName(), err);
        break;
    }
    case SerialCommandService::DispenseReply::INVALID:
        snprintf(details, sizeof(details),
                 "{\"commandId\":\"%s\",\"columnCode\":\"%c\",\"errorCode\":\"%s\"}",
                 commandId, columnCode, ErrorCode::ERR_INVALID_COMMAND_ID);
        mqttService.setLastError(ErrorCode::ERR_INVALID_COMMAND_ID);
        mqttService.publishEvent("DISPENSE_REJECTED", details);
        Logger::error(ErrorCode::ERR_INVALID_COMMAND_ID, "MQTT dispense ignored: invalid commandId '%s'", commandId);
        break;
    }
}

void onMqttMaintenance(const char *commandId, char columnCode, const char *operation)
{
    char details[192];
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
        Logger::error(ErrorCode::ERR_INVALID_OPERATION, "MQTT maintenance ignored: invalid operation '%s'", operation ? operation : "null");
        snprintf(details, sizeof(details),
                 "{\"commandId\":\"%s\",\"columnCode\":\"%c\",\"operation\":\"%s\",\"errorCode\":\"%s\"}",
                 commandId, columnCode, operation ? operation : "", ErrorCode::ERR_INVALID_OPERATION);
        mqttService.setLastError(ErrorCode::ERR_INVALID_OPERATION);
        mqttService.publishEvent("MAINTENANCE_REJECTED", details);
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

    const char *err = (dispenser.state() == DispenseState::FAULT)
                          ? ErrorCode::ERR_SYSTEM_FAULT
                          : ErrorCode::ERR_MACHINE_BUSY;
    snprintf(details, sizeof(details),
             "{\"commandId\":\"%s\",\"columnCode\":\"%c\",\"state\":\"%s\",\"errorCode\":\"%s\"}",
             commandId, columnCode, dispenser.stateName(), err);
    mqttService.setLastError(err);
    char eventType[48];
    snprintf(eventType, sizeof(eventType), "%sREJECTED", prefix);
    mqttService.publishEvent(eventType, details);
    Logger::warn("MQTT maintenance rejected for %s: state %s (%s)", commandId, dispenser.stateName(), err);
}

void setup()
{
    Serial.begin(AppConfig::SERIAL_BAUD);
    delay(200);

    if (!servoDriver.begin(PinConfig::SERVO_1, PinConfig::SERVO_2, PinConfig::SERVO_3, PinConfig::SERVO_4))
    {
        Logger::error(ErrorCode::ERR_SERVO_INIT, "Servo initialization failed; check pins in include/pin_config.h");
        mqttService.setLastError(ErrorCode::ERR_SERVO_INIT);
    }
    sensorDriver.begin(PinConfig::SENSOR);
    temperatureSensor.begin(PinConfig::TEMPERATURE_SENSOR);
    dispenser.begin();
    configPortal.begin();
    if (!wifiService.begin(configPortal))
    {
        configPortal.startPortal();
    }
    mqttService.onDispense(onMqttDispense);
    mqttService.onMaintenance(onMqttMaintenance);
    mqttService.begin(configPortal);
    serialCommands.begin();
}

void loop()
{
    serialCommands.loop();
    dispenser.update();

    // Check if initial boot error needs to be reported to backend once MQTT connects
    if (!bootErrorPublished && mqttService.connected())
    {
        bootErrorPublished = true;
        if (!servoDriver.isReady())
        {
            mqttService.publishError(ErrorCode::ERR_SERVO_INIT, "Hardware servo driver initialization failed at boot");
        }
    }

    DispenseController::Result result;
    if (dispenser.takeResult(result))
    {
        if (result.outcome != DispenseOutcome::OK)
        {
            mqttService.setLastError(ErrorCode::ERR_DISPENSE_ABORTED);
            Logger::error(ErrorCode::ERR_DISPENSE_ABORTED, "Cycle aborted for commandId: %s (col %c)",
                          result.commandId, result.columnCode);
        }

        if (result.maintenanceClear)
        {
            char maintenanceDetails[192];
            if (result.outcome == DispenseOutcome::OK)
            {
                snprintf(maintenanceDetails, sizeof(maintenanceDetails),
                         "{\"commandId\":\"%s\",\"columnCode\":\"%c\",\"operation\":\"%s\"}",
                         result.commandId, result.columnCode,
                         result.maintenanceOperation);
            }
            else
            {
                snprintf(maintenanceDetails, sizeof(maintenanceDetails),
                         "{\"commandId\":\"%s\",\"columnCode\":\"%c\",\"operation\":\"%s\",\"errorCode\":\"%s\"}",
                         result.commandId, result.columnCode,
                         result.maintenanceOperation,
                         result.errorCode[0] != '\0' ? result.errorCode : ErrorCode::ERR_DISPENSE_ABORTED);
            }
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
            char details[160];
            if (result.outcome == DispenseOutcome::OK)
            {
                snprintf(details, sizeof(details), "{\"commandId\":\"%s\",\"columnCode\":\"%c\"}",
                         result.commandId, result.columnCode);
            }
            else
            {
                snprintf(details, sizeof(details),
                         "{\"commandId\":\"%s\",\"columnCode\":\"%c\",\"errorCode\":\"%s\"}",
                         result.commandId, result.columnCode,
                         result.errorCode[0] != '\0' ? result.errorCode : ErrorCode::ERR_DISPENSE_ABORTED);
            }
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

    float temperatureC = 0.0F;
    if (temperatureSensor.update(temperatureC))
    {
        Logger::info("Temperature: %.2f C", temperatureC);
        mqttService.publishTemperatureTelemetry(temperatureC);
    }

    wifiService.loop();
    mqttService.loop();
    configPortal.loop();
}
