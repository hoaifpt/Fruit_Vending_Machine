# LILYGO T-Display-S3 Wi-Fi & Network Architecture

**Document Version:** 1.0.0  
**Classification:** Authoritative Technical Reference  
**Status:** `VERIFIED`

---

## 1. Network Topology & Modes

The firmware implements dual-mode Wi-Fi networking (**`WIFI_AP_STA`**), allowing the device to simultaneously operate as an autonomous wireless access point while connecting as a client station to an upstream infrastructure network.

```
+-------------------------------------------------------------------------+
|                        ESP32-S3 Wi-Fi Subsystem                         |
|                                                                         |
|  [SoftAP Mode: ESP32-Servo]                   [Station Mode (STA)]      |
|  - IP: 192.168.4.1                            - IP: DHCP Assigned       |
|  - Channel: 1 (2.4 GHz)                       - Connects to Home/Office |
|  - WPA2-PSK Security                          - Gateway Route           |
|                                                                         |
|              ^                                              ^           |
|              |                                              |           |
|              v                                              v           |
|     Direct Web Control                            Local LAN Dashboard   |
|   (Mobile Phone / Laptop)                        (server.py / API)      |
+-------------------------------------------------------------------------+
```

---

## 2. Autonomous SoftAP Specification

The onboard SoftAP enables direct field operation without requiring an external Wi-Fi router.

| Parameter | Configuration | Status |
|---|---|---|
| **Wi-Fi Mode** | `WIFI_AP_STA` | `IMPLEMENTED` |
| **Default AP SSID** | `ESP32-Servo` | `IMPLEMENTED` |
| **Default AP Password** | `12345678` | `IMPLEMENTED` |
| **AP Authentication** | WPA2-PSK (AES-CCMP) | `VERIFIED` |
| **AP Static IP** | `192.168.4.1` | `VERIFIED` |
| **Subnet Mask** | `255.255.255.0` | `VERIFIED` |
| **DHCP Lease Pool** | `192.168.4.2` – `192.168.4.10` | `VERIFIED` |
| **Max Concurrent Clients** | 4 clients | `VERIFIED` |
| **Embedded Web Server** | Port 80 (HTTP 1.1) | `IMPLEMENTED` |

---

## 3. Station Mode (STA) & Credential Management

### Security Principle: Never Hard-Code Production Secrets
Firmware should never check in hardcoded passwords into public repositories. Use one of two verified patterns:

#### Pattern A: NVS Flash Configuration (Current Project Implementation)
Credentials and parameters are stored in non-volatile storage (`Preferences.h`) in flash:
```cpp
preferences.begin("servo_cfg", false);
String ssid = preferences.getString("wifi_ssid", "");
String pass = preferences.getString("wifi_pass", "");
preferences.end();
```

#### Pattern B: Build Flag Injection (Production CI/CD)
Inject credentials via environment variables during `pio run`:
```ini
; In platformio.ini
build_flags =
    -D WIFI_SSID=\"${sysenv.WIFI_SSID}\"
    -D WIFI_PASS=\"${sysenv.WIFI_PASS}\"
```

---

## 4. Connection Lifecycle & Non-Blocking Reconnect

To prevent the motion control state machine or LCD renderer from stuttering during network dropouts, Wi-Fi reconnection must remain strictly non-blocking:

```cpp
void setupWiFi() {
    WiFi.mode(WIFI_AP_STA);
    
    // 1. Start SoftAP immediately for guaranteed field access
    WiFi.softAP(AP_SSID, AP_PASSWORD);
    
    // 2. Enable automatic background reconnection in ESP-IDF stack
    WiFi.setAutoReconnect(true);
    
    // 3. Connect to station network if configured
    if (sta_ssid.length() > 0) {
        WiFi.begin(sta_ssid.c_str(), sta_password.c_str());
    }
}

void checkWiFiHealth() {
    static unsigned long lastCheck = 0;
    if (millis() - lastCheck > 10000) { // Check every 10 seconds
        lastCheck = millis();
        if (WiFi.status() != WL_CONNECTED && sta_ssid.length() > 0) {
            Serial.println("[WIFI] Reconnecting to station...");
            WiFi.reconnect();
        }
    }
}
```

---

## 5. Offline Autonomous Fallback

If no Wi-Fi network is available or credentials fail:
1.  **Zero Lockup:** The firmware proceeds to `[SYSTEM] READY` without waiting indefinitely.
2.  **SoftAP Survives:** The local access point (`192.168.4.1`) remains fully operational.
3.  **Serial CLI Survives:** The USB CDC interface on `COM3` processes all motion and calibration commands independently of network state.
