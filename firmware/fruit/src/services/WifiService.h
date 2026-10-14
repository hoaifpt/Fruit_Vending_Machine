#pragma once

#include <Arduino.h>

class WifiService
{
public:
    bool begin();
    void loop();

private:
    unsigned long lastAttemptAt = 0;
    bool connectionLogged = false;
};
