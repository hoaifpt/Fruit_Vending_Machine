# LILYGO T-Display-S3 Hardware & Firmware Troubleshooting Guide

**Document Version:** 1.0.0  
**Classification:** Authoritative Technical Reference  
**Status:** `VERIFIED`

---

## 1. Master Troubleshooting Matrix

| Problem | Root Cause | Empirical Verification | Verified Solution |
|---|---|---|---|
| **LCD is completely blank / black** | Peripheral power gate (`GPIO 15`) or Backlight (`GPIO 38`) not asserted HIGH. | Backlight LED does not illuminate; multimeter shows 0V on LCD VDD test pad. | Call `pinMode(15, OUTPUT); digitalWrite(15, HIGH);` and `pinMode(38, OUTPUT); digitalWrite(38, HIGH);` at the very start of `setup()`. |
| **Upload failed: `Device does not recognize command`** | USB CDC buffer overrun during high-speed flash writing on Windows host controllers. | `esptool.py` errors out after writing a few blocks at 460,800 baud. | Pin `upload_speed = 115200` in `platformio.ini`. |
| **Upload failed: `Cannot open COM port / Access is denied`** | COM port is already held open by another process (`server.py`, serial monitor, or PuTTY). | Windows returns error code 5 (Access Denied). | Terminate background Python servers and close all active serial monitor terminals before flashing. |
| **Board cannot be detected / Keeps disconnecting** | Faulty user firmware in flash is bootlooping or crashing USB CDC stack. | Windows plays USB disconnect/connect sound repeatedly. | Enter **Manual Bootloader Mode**: Hold BOOT (GPIO 0), press and release RST, wait 1.5s, then release BOOT. Flash clean firmware. |
| **Serial Monitor is blank despite `Serial.println()`** | Missing build flags directing `Serial` to the internal USB CDC endpoint. | Board boots and runs, but virtual COM port transmits 0 characters. | Add `-D ARDUINO_USB_CDC_ON_BOOT=1` and `-D ARDUINO_USB_MODE=1` to `build_flags` in `platformio.ini`. |
| **ESP32 reboots immediately when servo moves** | **Brownout Reset**: Servo is powered directly from the ESP32 board, drawing 1A+ surge current and collapsing the 3.3V rail. | Serial console logs: `Brownout detector was triggered` or reset reason `0x0f (RTCWDT_BROWN_OUT_RESET)`. | Power the servo from an **external 5V DC power supply (2A min)**. Connect external power ground to ESP32 GND. Add a 470µF capacitor across servo 5V and GND. |
| **Servo slowly creeps/drifts when stopped** | Control line floats in high-impedance (Hi-Z) after `servo.detach()`, picking up inductive noise spikes. | Motor shaft continues turning at 1–3 RPM even though software state is `"DUNG"` (STOP). | Implement **Active Ground Clamping**: After detaching, set `pinMode(SERVO_PIN, OUTPUT); digitalWrite(SERVO_PIN, LOW);`. |
| **Build error: `fatal error: esp32-hal-periman.h`** | `Arduino_GFX_Library` $\ge 1.5.0$ installed, which expects Arduino Core 3.x Peripheral Manager. | PlatformIO build fails during GFX library compilation. | Pin `moononournation/GFX Library for Arduino@1.4.9` in `platformio.ini`. |
| **Firmware locks up during `setup()` on servo attach** | `ESP32Servo` $\ge 3.1.0$ installed, which hits an infinite MCPWM register loop on ESP32-S3. | Firmware halts permanently at `servo.attach()`. | Pin `madhephaestus/ESP32Servo@1.2.1` in `platformio.ini` (uses stable LEDC timers). |
| **Display shows noisy 35px border on one side** | Geometry offset omitted in ST7789 constructor for 170x320 panel. | Graphical UI is shifted horizontally by 35 pixels; right edge is cut off. | Pass column offset `35` to `Arduino_ST7789` constructor: `(bus, 5, 0, true, 170, 320, 35, 0, 35, 0)`. |
| **LCD colors are inverted (White is Black, Red is Cyan)** | IPS color inversion bit not toggled in driver registers. | Display graphics appear as a photonegative. | Set the `IPS` parameter to `true` in `Arduino_ST7789` constructor. |
| **Wi-Fi SoftAP fails to broadcast** | Wi-Fi radio not started in dual mode. | Phone Wi-Fi search cannot locate SSID `ESP32-Servo`. | Call `WiFi.mode(WIFI_AP_STA);` prior to `WiFi.softAP(AP_SSID, AP_PASSWORD);`. |

---

## 2. Step-by-Step Recovery from Bricked Firmware

If the board stops responding to PlatformIO upload commands:

```
Step 1: Unplug all external peripherals connected to GPIO 1, 2, 3, 10, 11, 12, 13.
Step 2: Connect the board directly to your computer using a known-good USB-C data cable (avoid unpowered USB hubs).
Step 3: Press and HOLD the physical "BOOT" button (labeled on PCB back near USB connector).
Step 4: Press and release the physical "RST" button once.
Step 5: Release the "BOOT" button after 1.5 seconds.
Step 6: Run PlatformIO erase flash command:
        pio run -e lilygo-t-display-s3 -t erase -p COM3
Step 7: Upload verified clean firmware:
        pio run -e lilygo-t-display-s3 -t upload -p COM3
Step 8: Press the "RST" button once to boot into normal execution.
```
