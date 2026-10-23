#include "core/runtime_api.hpp"

// 17. WIFI SETUP
// ============================================================

void setupWiFi() {
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(AP_SSID, AP_PASSWORD);
    Serial.print("[WIFI] SoftAP started! SSID: ");
    Serial.print(AP_SSID);
    Serial.print(" | IP: ");
    Serial.println(WiFi.softAPIP());
}

// ============================================================
