#pragma once

#include <Arduino.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <WebServer.h>

class ConfigPortalService
{
public:
    bool begin();
    void startPortal();
    void loop();
    bool portalActive() const { return active; }

    const char *wifiSsid() const { return wifiSsidValue.c_str(); }
    const char *wifiPassword() const { return wifiPasswordValue.c_str(); }
    const char *mqttHost() const { return mqttHostValue.c_str(); }
    uint16_t mqttPort() const { return mqttPortValue; }
    const char *machineCode() const { return machineCodeValue.c_str(); }
    const char *mqttPassword() const { return mqttPasswordValue.c_str(); }

private:
    Preferences preferences;
    DNSServer dnsServer;
    WebServer webServer;
    String wifiSsidValue;
    String wifiPasswordValue;
    String mqttHostValue;
    uint16_t mqttPortValue = 1883;
    String machineCodeValue;
    String mqttPasswordValue;
    bool active = false;

    void load();
    void handleRoot();
    void handleSave();
    void handleNotFound();
    String page(const char *message = nullptr) const;
    bool validField(const String &value, size_t maxLength, bool required) const;
};
