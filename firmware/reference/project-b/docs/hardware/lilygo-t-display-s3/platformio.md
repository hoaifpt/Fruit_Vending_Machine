# LILYGO T-Display-S3 PlatformIO Reference & Build Guide

**Document Version:** 1.0.0  
**Classification:** Authoritative Technical Reference  
**Status:** `VERIFIED`

---

## 1. Verified `platformio.ini` Configuration

The authoritative, verified `platformio.ini` located at the root of the repository:

```ini
[platformio]
default_envs = lilygo-t-display-s3
src_dir = .

[env:lilygo-t-display-s3]
platform = espressif32
board = lilygo-t-display-s3
framework = arduino
monitor_speed = 115200
upload_speed = 115200
lib_deps =
    madhephaestus/ESP32Servo@1.2.1
    moononournation/GFX Library for Arduino@1.4.9
build_flags =
    -D ARDUINO_USB_CDC_ON_BOOT=1
    -D ARDUINO_USB_MODE=1
```

---

## 2. Detailed Parameter Rationale

| Parameter | Configuration Value | Critical Rationale |
|---|---|---|
| `platform` | `espressif32` | Uses the official PlatformIO Espressif 32 development platform. Stable upstream release 7.1.3 corresponds to Arduino-ESP32 Core 2.0.17. |
| `board` | `lilygo-t-display-s3` | Built-in PlatformIO board definition that sets chip target to `esp32s3`, 16MB flash parameters, and Octal PSRAM flags. |
| `framework` | `arduino` | Target application layer framework. |
| `monitor_speed` | `115200` | Baud rate for virtual USB CDC serial console. |
| `upload_speed` | `115200` | Pinned to 115,200 baud for rock-solid native CDC flashing without Windows USB host framing drops. |
| `build_flags` | `-D ARDUINO_USB_CDC_ON_BOOT=1`<br>`-D ARDUINO_USB_MODE=1` | Directs all `Serial` statements to the internal USB-Serial/JTAG CDC port rather than UART0. |

---

## 3. Strict Dependency Pinning Rationale

> [!WARNING]
> Do NOT upgrade these libraries to unpinned `latest`. Upgrading introduces fatal hardware deadlocks and compiler failures on the ESP32-S3 platform.

### Bug 1: `madhephaestus/ESP32Servo@1.2.1`
*   **The Hazard:** Starting with version `3.1.0+`, the `ESP32Servo` library switched from the proven ESP32 LEDC PWM peripheral to the ESP32-S3 MCPWM hardware registers. When initializing on GPIO 1, this driver hits an infinite `while(1)` polling loop in hardware register configuration, locking up the CPU completely during `setup()`.
*   **The Fix:** Pinning strictly to `@1.2.1` uses the stable, battle-tested LEDC timer channels (0–3), which operate with 0% CPU overhead and zero deadlock risk.

### Bug 2: `moononournation/GFX Library for Arduino@1.4.9`
*   **The Hazard:** Starting with version `1.5.0+`, `GFX Library for Arduino` incorporated calls to `esp32-hal-periman.h` (Peripheral Manager), an API introduced only in Arduino Core 3.x. Compiling against PlatformIO Core 2.0.17 results in:
    ```
    fatal error: esp32-hal-periman.h: No such file or directory
    ```
*   **The Fix:** Pinning strictly to `@1.4.9` provides complete 8-bit parallel bus acceleration (`Arduino_ESP32PAR8Q`) without depending on unreleased Core 3.x headers.

---

## 4. Standard Command Line Interface (CLI)

Run all commands from the repository root:

### 1. Build Firmware (Compile & Link)
```bash
pio run -e lilygo-t-display-s3
```
*Expected Output:*
```
RAM:   [=         ]  13.7% (used 44932 bytes from 327680 bytes)
Flash: [=         ]  12.2% (used 800141 bytes from 6553600 bytes)
========================= [SUCCESS] =========================
```

### 2. Upload Firmware (Flash Target Board)
```bash
pio run -e lilygo-t-display-s3 -t upload -p COM3
```
*Note:* Replace `COM3` with your board's detected port.

### 3. Open Serial Telemetry Monitor
```bash
pio device monitor -p COM3 -b 115200
```
*Shortcut to exit monitor:* `Ctrl + ]`

### 4. Clean Build Directory
```bash
pio run -e lilygo-t-display-s3 -t clean
```
Use this when modifying header files (`web_ui.h`) or when switching library versions.

---

## 5. Troubleshooting Build & Upload Issues

| Error | Root Cause | Solution |
|---|---|---|
| `Serial port COM3: Access is denied` | The COM port is currently open in another program (e.g. `server.py`, VS Code Serial Monitor, or PuTTY). | Close the other application or stop `server.py` before running `pio run -t upload`. |
| `A fatal error occurred: The device does not recognize the command` | Host controller buffer overflow during high-speed native USB flashing. | Ensure `upload_speed = 115200` is set in `platformio.ini`. |
| `fatal error: esp32-hal-periman.h: No such file` | Upstream library version mismatch. | Verify `moononournation/GFX Library for Arduino@1.4.9` is pinned in `platformio.ini`. |
| `error: 'async' does not name a type` | PlatformIO `.ino` preprocessor mangled JavaScript `async function` in a raw string. | Move all HTML/JS out of the `.ino` and into a dedicated `PROGMEM` header file (`web_ui.h`). |
