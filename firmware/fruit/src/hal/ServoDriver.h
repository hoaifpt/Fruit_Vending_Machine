
#pragma once

#include <Arduino.h>
#include <ESP32Servo.h>

// Up to four continuous-rotation servos. A gate is a bit mask of servo numbers (bit 0 = servo 1), see AppConfig.
// A pulse of SERVO_STOP_US stops a servo; open/close turn it one way or the other until stopAll().
class ServoDriver
{
public:
    static constexpr uint8_t SERVO_COUNT = 4;

    bool begin(uint8_t pin1, uint8_t pin2, uint8_t pin3, uint8_t pin4);

    void openGate(uint8_t servoMask);
    void closeGate(uint8_t servoMask);

    // Calibration: raw pulse on one servo (number 1..4). Returns false for an invalid number or pulse.
    bool writePulse(uint8_t servoNumber, int pulseUs);

    void stopAll();

private:
    Servo servos[SERVO_COUNT];
    bool initialized = false;

    void writeMask(uint8_t servoMask, int pulseUs);
};
