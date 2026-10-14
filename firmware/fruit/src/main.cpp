
#include <Arduino.h>

#include "pin_config.h"
#include "application/DispenseController.h"
#include "hal/SensorDriver.h"
#include "hal/ServoDriver.h"
#include "services/MqttService.h"
#include "services/WifiService.h"

ServoDriver servoDriver;
SensorDriver sensorDriver;
DispenseController dispenseController(servoDriver);
WifiService wifiService;
MqttService mqttService(dispenseController);

void setup()
{
    Serial.begin(115200);

    bool servoReady = servoDriver.begin(
        PinConfig::SERVO_1,
        PinConfig::SERVO_2,
        PinConfig::SERVO_3,
        PinConfig::SERVO_4);

    if (!servoReady)
    {
        Serial.println("Servo initialization failed");
        return;
    }

    sensorDriver.begin(PinConfig::SENSOR);
    dispenseController.begin();
    wifiService.begin();
    mqttService.begin();
}

void loop()
{
    wifiService.loop();
    mqttService.loop();
    dispenseController.update();

    if (sensorDriver.update())
    {
        if (dispenseController.handleCommand(DispenseCommand::NEXT))
        {
            Serial.println("Sensor triggered: advanced dispense cycle");
        }
        else
        {
            Serial.println("Sensor triggered while servo is busy; ignored");
        }
    }
}
