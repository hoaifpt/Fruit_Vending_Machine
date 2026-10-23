# LILYGO T-Display-S3 Hardware Specification

**Document Version:** 1.0.0  
**Classification:** Authoritative Technical Reference  
**Status:** `VERIFIED`

---

## 1. System Overview

The **LILYGO T-Display-S3** is an ultra-compact IoT human-machine interface (HMI) board designed and manufactured by **Shenzhen Xin Yuan Electronic Technology Co., Ltd. (LilyGO)**. It integrates an **Espressif ESP32-S3R8** wireless microcontroller with a high-density **1.9-inch 170×320 IPS color LCD** driven over an ultra-fast **8-bit parallel 8080 bus**.

```
+-----------------------------------------------------------------------+
|                         LILYGO T-Display-S3                           |
|                                                                       |
|  +--------------------+   8-bit Parallel   +-----------------------+  |
|  |    ESP32-S3R8      |===================>|   1.9" IPS LCD Panel  |  |
|  |                    | (GPIO 39-42,45-48) |   ST7789 Controller   |  |
|  | - 240MHz Dual Core |                    |   170 x 320 Pixels    |  |
|  | - 16MB Flash       |   Control Lines    |   RGB565 16-bit Color |  |
|  | - 8MB OPI PSRAM    |------------------->|   Backlight: GPIO 38  |  |
|  | - 512KB SRAM       | (CS,DC,WR,RD,RST)  |                       |  |
|  +--------------------+                    +-----------------------+  |
|         ^       ^                                      ^              |
|         |       +------------ GPIO 15 (Power Gate) ----+              |
|         |                                                             |
|         v                                                             |
|   Native USB-C (GPIO 19/20)    Battery Circuit (JST-GH 1.25mm)        |
|   CDC/JTAG/DFU Interface       ADC Monitor (GPIO 4, 1:2 Divider)      |
+-----------------------------------------------------------------------+
```

---

## 2. Silicon & Microcontroller Specifications

| Parameter | Specification | Status | Evidence / Source |
|---|---|---|---|
| **SoC Model** | Espressif ESP32-S3 (ESP32-S3R8) | `VERIFIED` | ROM Boot Banner (`esp32s3-20210327`), Chip Revision v0.2 |
| **Package** | QFN56 (7×7 mm) | `VERIFIED` | LilyGO Hardware Schematic |
| **CPU Architecture** | 32-bit Xtensa dual-core LX7 microprocessor | `VERIFIED` | Espressif ESP32-S3 Datasheet |
| **Clock Frequency** | Up to 240 MHz (programmable 80/160/240 MHz) | `VERIFIED` | Arduino Core System Clock Initialization |
| **Hardware Coprocessors** | ULP (Ultra Low Power) FSM & RISC-V coprocessor | `VERIFIED` | ESP-IDF ULP Component |
| **SIMD / DSP Extensions** | 128-bit SIMD Vector Instructions for AI acceleration | `VERIFIED` | Espressif TRM Chapter 3 |
| **Internal ROM** | 384 KB Boot ROM | `VERIFIED` | Espressif ESP32-S3 TRM |
| **Internal SRAM** | 512 KB total (320 KB available for general heap) | `VERIFIED` | Heap telemetry: 327,680 bytes total SRAM pool |
| **Embedded PSRAM** | **8 MB Octal SPI (OPI)** high-speed PSRAM | `VERIFIED` | `esptool.py` Flash/PSRAM probe (`Embedded PSRAM 8MB AP_3v3`) |
| **External Flash** | **16 MB Quad/Octal SPI Flash** (GD25Q128 / W25Q128 compatible) | `VERIFIED` | Flash Size: 16 MB mapped partition table |
| **Flash Voltage Rail** | 3.3V | `VERIFIED` | Schematic VDD_SPI |

---

## 3. Wireless Subsystem Specifications

| Feature | Technical Parameters | Compliance / Standards |
|---|---|---|
| **Wi-Fi Protocol** | IEEE 802.11 b/g/n (1T1R) | Wi-Fi Alliance Certified |
| **Frequency Range** | 2.412 GHz ~ 2.484 GHz (Channels 1–14) | FCC / CE compliant |
| **Wi-Fi Throughput** | Up to 150 Mbps (802.11n 40MHz bandwidth) | Hardware MAC/BB |
| **Wi-Fi Modes** | Station (STA), SoftAP, Dual Mode (AP+STA) | `IMPLEMENTED` (`WiFi.mode(WIFI_AP_STA)`) |
| **SoftAP Max Clients** | Up to 4 simultaneous TCP connections | WebServer configuration |
| **Bluetooth Subsystem** | Bluetooth 5.0, Bluetooth LE (BLE), Bluetooth Mesh | Bluetooth SIG Core v5.0 |
| **BLE Data Rates** | 125 Kbps, 500 Kbps, 1 Mbps, 2 Mbps | Espressif BT Controller |
| **Antenna Type** | Onboard 3D Ceramic Antenna (Peak Gain: ~2 dBi) | Physical board layout |

---

## 4. Display Subsystem Specifications

> [!IMPORTANT]
> The T-Display-S3 does **NOT** use standard 4-wire SPI. It uses a high-bandwidth **8-bit Intel 8080 Parallel Bus**. Standard SPI LCD drivers (`Adafruit_ST7789` via SPI) **will not work**.

| Parameter | Specification | Technical Notes |
|---|---|---|
| **Display Panel Size** | 1.90 inches diagonal | Active visual display area |
| **Panel Technology** | IPS (In-Plane Switching) full-color TFT LCD | Ultra-wide viewing angle (>160° H/V) |
| **Controller IC** | Sitronix **ST7789V** / ST7789 | High-speed display driver |
| **Native Panel Resolution** | **170 (H) × 320 (V)** physical pixels | Note asymmetric width (170 instead of 240) |
| **Display Interface** | **8-bit Parallel 8080** (D0–D7 + CS + DC + WR + RD) | 8 parallel bits per write clock pulse |
| **Bus Clock Speed** | Up to 20 MHz parallel write cycle | Handled by ESP32-S3 dedicated I80 engine |
| **Color Depth** | 16-bit RGB565 (65,536 colors) | Little-endian color format |
| **Column Offset** | `col_offset = 35` | Required to center the 170-pixel window in 240-pixel driver SRAM |
| **Row Offset** | `row_offset = 0` | Mapped directly from line 0 to 319 |
| **Backlight Control** | **GPIO 38** (Active HIGH, PWM dimmable) | Connected via N-channel MOSFET gate |
| **Display Power Gate** | **GPIO 15** (Active HIGH) | Must be asserted HIGH to power display circuitry |

---

## 5. Power & Electrical Characteristics

### Absolute Maximum Ratings

| Parameter | Symbol | Min | Max | Unit |
|---|---|---|---|---|
| Supply Voltage (USB-C) | $V_{BUS}$ | 4.5 | 5.5 | V |
| Supply Voltage (Li-Po Battery) | $V_{BAT}$ | 3.0 | 4.35 | V |
| I/O Input Voltage | $V_{IN}$ | -0.3 | 3.6 | V |
| Maximum Output Current per GPIO | $I_{MAX\_GPIO}$ | - | 40 | mA |
| Recommended Operating Current per GPIO | $I_{NOM\_GPIO}$ | - | 12 | mA |
| Operating Temperature | $T_{OPR}$ | -40 | +85 | °C |

### Power Consumption Profiles

| Operating State | Typical Current @ 5V | Conditions |
|---|---|---|
| **Booting / Wi-Fi SoftAP Active + LCD 100% BL** | ~140 mA – 180 mA | Wi-Fi transmitting beacon, LCD on full brightness |
| **Steady State (Web Server Ready + LCD on)** | ~110 mA – 130 mA | Normal monitoring mode |
| **LCD Backlight Off (GPIO 38 LOW)** | ~70 mA | Reduced power while keeping CPU & Wi-Fi active |
| **Display Power Cut (GPIO 15 LOW + GPIO 38 LOW)**| ~45 mA | Screen completely de-energized |
| **Deep Sleep Mode** | ~15 µA – 25 µA | Wake up via Button 2 (GPIO 14) or Timer |

---

## 6. Physical Dimensions & Mechanical Layout

*   **PCB Length:** 65.0 mm
*   **PCB Width:** 26.0 mm
*   **Total Height (including screen & components):** ~10.5 mm
*   **Mounting Holes:** None (designed for snap-fit enclosures or 3D printed housings)
*   **Connectors:**
    *   1× USB Type-C (Reversible data + power)
    *   1× JST-GH 1.25mm 2-pin connector for 3.7V single-cell Li-Po battery
    *   2× 12-pin single-row 2.54mm pitch breakout headers
