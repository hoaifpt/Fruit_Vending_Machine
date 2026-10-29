#include <Arduino.h>

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
void onMqttDispense(const char *commandId, uint8_t column)
{
    char details[96];
    snprintf(details, sizeof(details), "{\"commandId\":\"%s\",\"column\":%u}", commandId, column);
    switch (serialCommands.requestDispense(commandId, column))
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
        snprintf(details, sizeof(details), "{\"commandId\":\"%s\",\"state\":\"%s\"}", commandId, dispenser.stateName());
        mqttService.publishEvent("DISPENSE_REJECTED", details);
        break;
    case SerialCommandService::DispenseReply::INVALID:
        Logger::info("MQTT dispense ignored: invalid commandId");
        break;
    }
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
        serialCommands.reportResult(result);
        char details[96];
        snprintf(details, sizeof(details), "{\"commandId\":\"%s\"}", result.commandId);
        mqttService.publishEvent(result.outcome == DispenseOutcome::OK ? "DISPENSE_COMPLETED" : "DISPENSE_ABORTED", details);
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
