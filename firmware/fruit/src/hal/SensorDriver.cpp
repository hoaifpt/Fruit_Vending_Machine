#include "SensorDriver.h"

#include "app_config.h"

void SensorDriver::begin(uint8_t sensorPin)
{
    pin = sensorPin;
    pinMode(pin, INPUT_PULLUP);
    stableState = digitalRead(pin);
    lastRawState = stableState;
    lastChangeAt = millis();
    initialized = true;
}

bool SensorDriver::update()
{
    if (!initialized)
    {
        return false;
    }

    const int rawState = digitalRead(pin);
    const unsigned long now = millis();

    if (rawState != lastRawState)
    {
        lastRawState = rawState;
        lastChangeAt = now;
    }

    if (rawState == stableState ||
        now - lastChangeAt < AppConfig::SENSOR_DEBOUNCE_MS)
    {
        return false;
    }

    stableState = rawState;
    return stableState == AppConfig::SENSOR_ACTIVE_LEVEL;
}
