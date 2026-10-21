#include "WifiService.h"

#include <WiFi.h>

#include "app_config.h"
#include "utils/Logger.h"

bool WifiService::begin()
{
    if (AppConfig::WIFI_SSID[0] == '\0')
    {
        Logger::info("Wi-Fi not configured (include/secrets.h); running Serial-only");
        return false;
    }

    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(AppConfig::WIFI_SSID, AppConfig::WIFI_PASSWORD);
    lastAttemptAt = millis();
    configured = true;
    Logger::info("Connecting to Wi-Fi %s...", AppConfig::WIFI_SSID);
    return true;
}

void WifiService::loop()
{
    if (!configured)
    {
        return;
    }

    if (WiFi.status() == WL_CONNECTED)
    {
        if (!connectionLogged)
        {
            Logger::info("Wi-Fi connected, IP %s", WiFi.localIP().toString().c_str());
            connectionLogged = true;
        }
        return;
    }

    if (connectionLogged)
    {
        Logger::info("Wi-Fi connection lost; the driver reconnects automatically");
        connectionLogged = false;
        lastAttemptAt = millis();
    }

    // Auto-reconnect normally recovers by itself; only restart the attempt if it has been stuck for a long time.
    const unsigned long now = millis();
    if (now - lastAttemptAt >= AppConfig::WIFI_RETRY_INTERVAL_MS)
    {
        lastAttemptAt = now;
        WiFi.reconnect();
        Logger::info("Retrying Wi-Fi connection...");
    }
}
