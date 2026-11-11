#include "WifiService.h"

#include <WiFi.h>

#include "app_config.h"
#include "services/ConfigPortalService.h"
#include "error_codes.h"
#include "utils/Logger.h"

bool WifiService::begin(ConfigPortalService &config)
{
    configPortal = &config;
    if (config.wifiSsid()[0] == '\0')
    {
        Logger::warn("Wi-Fi is not configured; starting configuration portal");
        return false;
    }

    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(config.wifiSsid(), config.wifiPassword());
    lastAttemptAt = millis();
    configured = true;
    Logger::info("Connecting to Wi-Fi %s...", config.wifiSsid());
    const unsigned long deadline = millis() + 15000UL;
    while (WiFi.status() != WL_CONNECTED && millis() < deadline)
    {
        delay(100);
    }
    if (WiFi.status() != WL_CONNECTED)
    {
        configured = false;
        Logger::warn("Wi-Fi connection timed out after 15 seconds");
        return false;
    }
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
        Logger::error(ErrorCode::ERR_WIFI_DISCONNECTED, "Wi-Fi connection lost; driver reconnecting automatically");
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
