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

// Dispense: kiosk/tablet -> USB Serial (SerialCommandService) -> DispenseController -> servos.
// MQTT is publish-only (status, events; telemetry once a temperature/humidity sensor is fitted). Works without Wi-Fi/MQTT.
ServoDriver servoDriver;
SensorDriver sensorDriver;
DispenseController dispenser(servoDriver);
SerialCommandService serialCommands(dispenser);
WifiService wifiService;
MqttService mqttService;

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
        char details[80];
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
