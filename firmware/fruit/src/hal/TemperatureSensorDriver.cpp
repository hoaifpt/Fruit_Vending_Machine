#include "TemperatureSensorDriver.h"

#include "app_config.h"
#include "utils/Logger.h"

void TemperatureSensorDriver::begin(uint8_t sensorPin)
{
    dataPin = sensorPin;
    oneWire = new OneWire(dataPin);
    sensor = new DallasTemperature(oneWire);
    sensor->begin();
    sensor->setResolution(12);
    sensor->setWaitForConversion(false);
    sensor->requestTemperatures();
    conversionStartedAt = millis();
    conversionPending = true;
    initialized = true;
    if (sensor->getDS18Count() == 0)
    {
        Logger::warn("DS18B20 not detected on GPIO %u", dataPin);
    }
    else
    {
        Logger::info("DS18B20 temperature sensor initialized on GPIO %u", dataPin);
    }
}

bool TemperatureSensorDriver::update(float &temperatureC)
{
    if (!initialized || sensor == nullptr)
    {
        return false;
    }

    const unsigned long now = millis();
    if (conversionPending)
    {
        if (now - conversionStartedAt < AppConfig::DS18B20_CONVERSION_TIME_MS)
        {
            return false;
        }

        const float value = sensor->getTempCByIndex(0);
        conversionPending = false;
        lastReadAt = now;
        if (value == DEVICE_DISCONNECTED_C)
        {
            Logger::warn("DS18B20 is disconnected on GPIO %u", dataPin);
        }
        else
        {
            temperatureC = value;
            return true;
        }
    }

    if (now - lastReadAt >= AppConfig::TEMPERATURE_READ_INTERVAL_MS)
    {
        sensor->requestTemperatures();
        conversionStartedAt = now;
        conversionPending = true;
    }
    return false;
}
