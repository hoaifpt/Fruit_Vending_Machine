
#pragma once

#include <Arduino.h>
#include <ESP32Servo.h>

class ServoDriver
{
public:
    bool begin(uint8_t pin1, uint8_t pin2, uint8_t pin3, uint8_t pin4);

    void openComponent1();
    void closeComponent1();
    void openComponent2();
    void closeComponent2();
    void closeAll();

    void stopAll();

private:
    Servo servo1;
    Servo servo2;
    Servo servo3;
    Servo servo4;

    bool initialized = false;

    void writeServo(
        Servo &servo,
        int pulseUs);
};
