#pragma once

#include <Arduino.h>

class ConfigPortalService;

class WifiService
{
public:
    bool begin(ConfigPortalService &config);
    void loop();

private:
    unsigned long lastAttemptAt = 0;
    bool connectionLogged = false;
    bool configured = false;
    ConfigPortalService *configPortal = nullptr;
};
