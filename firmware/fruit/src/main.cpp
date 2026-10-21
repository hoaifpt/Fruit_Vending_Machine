
// #include <Arduino.h>

// #include "pin_config.h"
// #include "application/DispenseController.h"
// #include "hal/SensorDriver.h"
// #include "hal/ServoDriver.h"
// #include "services/MqttService.h"
// #include "services/WifiService.h"

// ServoDriver servoDriver;
// SensorDriver sensorDriver;
// DispenseController dispenseController(servoDriver);
// WifiService wifiService;
// MqttService mqttService(dispenseController);

// void setup()
// {
//     Serial.begin(115200);

//     bool servoReady = servoDriver.begin(
//         PinConfig::SERVO_1,
//         PinConfig::SERVO_2,
//         PinConfig::SERVO_3,
//         PinConfig::SERVO_4);

//     if (!servoReady)
//     {
//         Serial.println("Servo initialization failed");
//         return;
//     }

//     sensorDriver.begin(PinConfig::SENSOR);
//     dispenseController.begin();
//     wifiService.begin();
//     mqttService.begin();
// }

// void loop()
// {
//     wifiService.loop();
//     mqttService.loop();
//     dispenseController.update();

//     if (sensorDriver.update())
//     {
//         if (dispenseController.handleCommand(DispenseCommand::NEXT))
//         {
//             Serial.println("Sensor triggered: advanced dispense cycle");
//         }
//         else
//         {
//             Serial.println("Sensor triggered while servo is busy; ignored");
//         }
//     }
// }






#include <Arduino.h>
#include <ESP32Servo.h>

Servo servo;

const int SERVO_PIN = 18;

// Servo quay lien tuc
const int STOP_US = 1500;
const int FORWARD_US = 1700;
const int REVERSE_US = 1300;

// Hieu chinh thoi gian theo co cau thuc te
const float MS_PER_DEGREE = 30.0;

bool running = false;
unsigned long stopTime = 0;

void stopServo() {
    servo.writeMicroseconds(STOP_US);
    running = false;
    Serial.println("Servo da dung.");
}

void rotateFor(int pulse, unsigned long duration) {
    servo.writeMicroseconds(pulse);
    running = true;
    stopTime = millis() + duration;
}

void setup() {
    Serial.begin(115200);
    Serial.setTimeout(50);

    servo.setPeriodHertz(50);
    servo.attach(SERVO_PIN, 500, 2400);
    servo.writeMicroseconds(STOP_US);

    Serial.println("Nhap 1-360: quay mo");
    Serial.println("R: quay nguoc de dong");
    Serial.println("S: dung");
}

void loop() {
    if (Serial.available() > 0) {
        String cmd = Serial.readStringUntil('\n');
        cmd.trim();
        cmd.toUpperCase();

        if (cmd == "S") {
            stopServo();
            return;
        }

        if (cmd == "R") {
            // Quay nguoc trong thoi gian tuong ung 120 don vi
            unsigned long duration =
                (unsigned long)(120 * MS_PER_DEGREE);

            rotateFor(REVERSE_US, duration);
            Serial.println("Dang quay nguoc de dong...");
            return;
        }

        bool valid = cmd.length() > 0;
        for (unsigned int i = 0; i < cmd.length(); i++) {
            if (!isDigit(cmd[i])) {
                valid = false;
                break;
            }
        }

        if (!valid) {
            Serial.println("Nhap 1-360, R hoac S.");
            return;
        }

        int angle = cmd.toInt();
        if (angle < 1 || angle > 360) {
            Serial.println("Goc phai tu 1 den 360.");
            return;
        }

        unsigned long duration =
            (unsigned long)(angle * MS_PER_DEGREE);

        rotateFor(FORWARD_US, duration);

        Serial.print("Dang quay mo: ");
        Serial.println(angle);
    }

    if (running && (long)(millis() - stopTime) >= 0) {
        stopServo();
    }
}
