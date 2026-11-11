#pragma once

#include <Arduino.h>
#include <DallasTemperature.h>
#include <OneWire.h>

class TemperatureSensorDriver
{
public:
    void begin(uint8_t dataPin);
    bool update(float &temperatureC);

private:
    OneWire *oneWire = nullptr;
    DallasTemperature *sensor = nullptr;
    uint8_t dataPin = 0;
    unsigned long conversionStartedAt = 0;
    unsigned long lastReadAt = 0;
    bool conversionPending = false;
    bool initialized = false;
};
