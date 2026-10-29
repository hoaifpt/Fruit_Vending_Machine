#pragma once

#include <Arduino.h>

class SensorDriver
{
public:
    void begin(uint8_t pin);
    bool update();

private:
    uint8_t pin = 0;
    int stableState = HIGH;
    int lastRawState = HIGH;
    unsigned long lastChangeAt = 0;
    bool initialized = false;
};
