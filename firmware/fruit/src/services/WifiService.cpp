#include "WifiService.h"

#include <WiFi.h>

#include "app_config.h"

bool WifiService::begin()
{
    if (AppConfig::WIFI_SSID[0] == '\0')
    {
        Serial.println("Wi-Fi is not configured; add include/secrets.h");
        return false;
    }

    WiFi.mode(WIFI_STA);
    WiFi.begin(AppConfig::WIFI_SSID, AppConfig::WIFI_PASSWORD);
    lastAttemptAt = millis();
    Serial.println("Connecting to Wi-Fi...");
    return true;
}

void WifiService::loop()
{
    if (WiFi.status() == WL_CONNECTED)
    {
        if (!connectionLogged)
        {
            Serial.print("Wi-Fi connected, IP: ");
            Serial.println(WiFi.localIP());
            connectionLogged = true;
        }
        return;
    }

    connectionLogged = false;
    if (AppConfig::WIFI_SSID[0] == '\0')
    {
        return;
    }

    const unsigned long now = millis();
    if (now - lastAttemptAt >= AppConfig::WIFI_RETRY_INTERVAL_MS)
    {
        lastAttemptAt = now;
        WiFi.disconnect();
        WiFi.begin(AppConfig::WIFI_SSID, AppConfig::WIFI_PASSWORD);
        Serial.println("Retrying Wi-Fi connection...");
    }
}
