# LILYGO T-Display-S3 Hardware & Firmware Documentation

This directory contains the authoritative technical documentation for the **LILYGO T-Display-S3** (ESP32-S3R8 with 1.9-inch ST7789 8-bit parallel LCD) target platform.

---

## 1. Quick Identity & Status Matrix

| Parameter | Specification | Status | Source / Evidence |
|---|---|---|---|
| **Product Name** | LILYGO T-Display-S3 (Non-Touch & Touch variants) | `VERIFIED` | [LilyGO Official Repo](https://github.com/Xinyuan-LilyGO/T-Display-S3) |
| **Manufacturer** | Shenzhen Xin Yuan Electronic Technology Co., Ltd. (LilyGO) | `VERIFIED` | LilyGO Hardware Catalog |
| **SoC** | Espressif ESP32-S3 (ESP32-S3R8 QFN56) | `VERIFIED` | ESP-ROM Boot Log / Chip ID |
| **CPU Architecture** | Dual-core 32-bit Xtensa LX7 @ 240 MHz (with Vector Instructions) | `VERIFIED` | Espressif ESP32-S3 Datasheet |
| **Internal SRAM** | 512 KB (320 KB usable for SRAM application heaps) | `VERIFIED` | ESP32-S3 TRM |
| **External Flash** | 16 MB Quad/Octal SPI Flash | `VERIFIED` | `esptool.py` Flash Detection |
| **External PSRAM** | 8 MB Octal SPI (OPI) PSRAM | `VERIFIED` | LilyGO T-Display-S3 PinMap |
| **Display Panel** | 1.9-inch IPS TFT LCD (ST7789V controller) | `VERIFIED` | Official `Arduino_GFXDemo.ino` |
| **Display Resolution** | 170 × 320 physical pixels (RGB565 16-bit color) | `VERIFIED` | Display datasheet / `Setup206` |
| **Display Bus** | 8-bit Parallel 8080 (Intel 8080 I80 bus, **NOT SPI**) | `VERIFIED` | `Arduino_ESP32PAR8Q` initialization |
| **Peripheral Power** | **GPIO 15** (Active HIGH enable for LCD & VBUS/VBAT boost) | `VERIFIED` | Hardware Schematic & HIL Testing |
| **Backlight PWM** | **GPIO 38** (Active HIGH / LEDC dimmable) | `VERIFIED` | Pin config / HIL Execution |
| **USB Interface** | USB Type-C, direct native USB CDC/JTAG (GPIO 19 D-, GPIO 20 D+) | `VERIFIED` | USB Hardware Descriptor (`303A:1001`) |
| **Primary Actuator** | Continuous 360° Rotation Servo on **GPIO 1** | `IMPLEMENTED` | [ESP32_Control_Center_ServoStop_FIXED_v2.ino](../../../ESP32_Control_Center_ServoStop_FIXED_v2.ino) |

---

## 2. Documentation Sitemap

Every document in this directory addresses a specific engineering domain:

1. [Hardware Specification](hardware-specification.md): Complete electrical and silicon specifications (SoC, Flash, PSRAM, USB, power rails).
2. [Pinout & GPIO Reference](pinout.md): Comprehensive pin matrix (Display bus, Boot buttons, Battery ADC, I2C/Touch, and expansion headers).
3. [Display Subsystem](display.md): ST7789 8-bit parallel bus, timing, row/column offsets, and library driver configuration.
4. [Power Management & GPIO 15](power.md): Deep dive into GPIO 15 peripheral power gating, battery charger, and low-power behavior.
5. [USB, Flashing & Debugging](usb-debugging.md): Native USB CDC, ROM download mode (BOOT/RST sequences), and serial troubleshooting.
6. [PlatformIO Guide](platformio.md): Environment settings, build flags, upload speeds, and reproducible compilation steps.
7. [Wi-Fi Subsystem](wifi.md): Dual-mode (AP + STA), embedded WebServer, network lifecycle, and recovery.
8. [Firmware Architecture](firmware-architecture.md): Modular architecture roadmap vs. existing monolithic `.ino` design.
9. [Device Protocol](protocol.md): Verified JSON over Serial & REST endpoints vs. PROPOSED industrial binary packet protocol.
10. [Peripheral Safety & Actuators](peripherals.md): Electrical isolation, flyback suppression, external 5V power routing, and ground clamping.
11. [Testing & HIL Verification](testing.md): 5-phase Hardware-in-the-Loop test harness, verification evidence, and verification labels.
12. [Troubleshooting Guide](troubleshooting.md): Symptom-cause-solution matrix for blank LCDs, upload hangs, brownouts, and servo drift.

---

## 3. Strict Development Rules for Agents (Codex & Antigravity)

> [!CAUTION]
> **RULE 1: NEVER assume standard ESP32-S3 pin mappings.**  
> The T-Display-S3 routes 14 GPIO lines strictly to the display (GPIO 5, 6, 7, 8, 9, 15, 38, 39, 40, 41, 42, 45, 46, 47, 48). Using any of these pins for external actuators or sensors will corrupt the display or destroy the frame buffer.

> [!IMPORTANT]
> **RULE 2: GPIO 15 MUST be driven HIGH at the very beginning of `setup()`.**  
> ```cpp
> pinMode(15, OUTPUT);
> digitalWrite(15, HIGH);
> ```
> If GPIO 15 is not pulled HIGH, the LCD power circuit remains unpowered when running on battery or external headers.

> [!WARNING]
> **RULE 3: NEVER power a servo motor directly from the ESP32 3.3V or 5V rail.**  
> Actuators require an external 5V power supply (1.5A–2.5A peak). The external power supply ground **MUST** be common with the ESP32 ground.

> [!NOTE]
> **RULE 4: Display uses an 8-bit Parallel Bus (I8080), NOT SPI.**  
> Do not configure SPI drivers (`SPI.begin()`) for the ST7789 display. It requires `Arduino_ESP32PAR8Q` (in `Arduino_GFX_Library`) or `Setup206_LilyGo_T_Display_S3.h` (in `TFT_eSPI`).

---

## 4. Verified Build & Flash Quick Reference

From the project root:

```bash
# 1. Compile firmware
pio run -e lilygo-t-display-s3

# 2. Upload firmware via COM3 (native CDC at 115200 baud)
pio run -e lilygo-t-display-s3 -t upload -p COM3

# 3. Open Serial Monitor (115200 baud)
pio device monitor -p COM3 -b 115200

# 4. Clean build artifacts if dependency issues occur
pio run -e lilygo-t-display-s3 -t clean
```
